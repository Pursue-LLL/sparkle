import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANYTLS_TW,
  assertLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  HOUR_MS,
  HY2_TW,
  NODES,
  NOW,
  readCache,
  readProviderMembers,
  settle,
  SS_TW,
  useMailRig,
  VLESS_JP,
  world,
  writeCache,
  writeCacheRaw,
  writeProviderMembers,
  writeProviderRaw
} from './sparkleMailProbeRig'

const PRIORITY = ['台湾', '日本', '韩国', '新加坡', '美国']
const WARM_UP = 'delay:📧 邮件专用:https://mail.google.com'

describe('sparkleMailProbe cache', () => {
  const mail = useMailRig()

  it('starts empty when there is no cache file', async () => {
    assert.equal((await mail.probe().loadSparkleMailProbeCache(NOW)).size, 0)
  })

  it('keeps well-formed fresh records and drops stale or malformed ones', async () => {
    writeCache({
      fresh: cacheRecord(true, 80, HOUR_MS),
      aliveJustInsideTtl: cacheRecord(true, 80, 12 * HOUR_MS - 1),
      aliveAtTtl: cacheRecord(true, 80, 12 * HOUR_MS),
      deadJustInsideTtl: cacheRecord(false, 0, 6 * HOUR_MS - 1),
      deadAtTtl: cacheRecord(false, 0, 6 * HOUR_MS),
      noRtt: { alive: true, checkedAt: NOW },
      badFlag: { alive: 'yes', rttMs: 1, checkedAt: NOW },
      badTime: { alive: true, rttMs: 1, checkedAt: '2026' },
      nothing: null
    })

    const cache = await mail.probe().loadSparkleMailProbeCache(NOW)

    assert.deepEqual(
      [...cache.keys()].sort(),
      ['aliveJustInsideTtl', 'deadJustInsideTtl', 'fresh'].sort()
    )
  })

  it('treats an unreadable cache file as empty', async () => {
    writeCacheRaw('{not json')

    assert.equal((await mail.probe().loadSparkleMailProbeCache(NOW)).size, 0)
  })

  it('reads the file afresh on every call', async () => {
    writeCache({ first: cacheRecord(true) })
    assert.deepEqual([...(await mail.probe().loadSparkleMailProbeCache(NOW)).keys()], ['first'])

    writeCache({ second: cacheRecord(true) })

    assert.deepEqual([...(await mail.probe().loadSparkleMailProbeCache(NOW)).keys()], ['second'])
  })

  it('saves records so that they load back', async () => {
    const record = cacheRecord(true, 70)

    await mail.probe().saveSparkleMailProbeCache(new Map([[cacheKey(HY2_TW), record]]))

    assert.deepEqual(readCache(), { [cacheKey(HY2_TW)]: record })
    assert.deepEqual(
      [...(await mail.probe().loadSparkleMailProbeCache(NOW)).keys()],
      [cacheKey(HY2_TW)]
    )
  })
})

describe('sparkleMailProbe loadCurrentMailProxies', () => {
  const mail = useMailRig()

  it('returns the nodes of the selected profile', async () => {
    assert.deepEqual(await mail.probe().loadCurrentMailProxies(), NODES)
  })

  it('returns no nodes when the default profile is selected', async () => {
    world.profile = { current: 'default' }

    assert.deepEqual(await mail.probe().loadCurrentMailProxies(), [])
  })

  it('returns no nodes when no profile is selected', async () => {
    world.profile = {}

    assert.deepEqual(await mail.probe().loadCurrentMailProxies(), [])
  })

  it('lets a config failure reach the caller', async () => {
    world.profileError = true

    await assert.rejects(mail.probe().loadCurrentMailProxies(), /profile config unreadable/)
  })
})

describe('sparkleMailProbe writeSparkleMailProviderFromCache', () => {
  const mail = useMailRig()

  it('writes the nodes in region order and leaves out AnyTLS', async () => {
    const result = await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)

    assert.deepEqual(readProviderMembers(), ['台湾-HY2', '台湾-SS', '日本-VLESS', '美国-SS'])
    assert.deepEqual(result, { count: 4, membershipChanged: true })
  })

  it('keeps only the verified nodes, quickest first within a region', async () => {
    const cache = new Map([
      [cacheKey(HY2_TW), cacheRecord(true, 200)],
      [cacheKey(SS_TW), cacheRecord(true, 90)],
      [cacheKey(VLESS_JP), cacheRecord(false)]
    ])

    const result = await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY, cache)

    assert.deepEqual(readProviderMembers(), ['台湾-SS', '台湾-HY2'])
    assert.equal(result.count, 2)
  })

  it('drops the nodes confirmed dead while nothing is verified yet', async () => {
    const cache = new Map([[cacheKey(HY2_TW), cacheRecord(false)]])

    await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY, cache)

    assert.deepEqual(readProviderMembers(), ['台湾-SS', '日本-VLESS', '美国-SS'])
  })

  it('writes an empty provider when there is nothing but AnyTLS', async () => {
    const result = await mail.probe().writeSparkleMailProviderFromCache([ANYTLS_TW], PRIORITY)

    assert.deepEqual(readProviderMembers(), [])
    assert.deepEqual(result, { count: 0, membershipChanged: false })
  })

  it('reports a membership change only when nodes were added or removed', async () => {
    writeProviderMembers(['美国-SS', '日本-VLESS', '台湾-SS', '台湾-HY2'])
    const reordered = await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)
    assert.deepEqual(reordered, { count: 4, membershipChanged: false })

    writeProviderMembers(['台湾-SS'])
    const removedFromFile = await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)
    assert.equal(removedFromFile.membershipChanged, true)
  })

  it('ignores blank entries in the previous provider file and keeps one-letter names', async () => {
    const single = { name: 'X', type: 'ss', server: 'x.example.com', port: 1 }
    writeProviderRaw('proxies:\n  - name: ""\n  - name: "   "\n  - name: X\n')

    const result = await mail.probe().writeSparkleMailProviderFromCache([single], PRIORITY)

    assert.deepEqual(result, { count: 1, membershipChanged: false })
  })

  it('counts an unreadable or member-less provider file as having no members', async () => {
    for (const body of ['proxies: [unclosed', 'other: 1\n']) {
      writeProviderRaw(body)

      const result = await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)

      assert.equal(result.membershipChanged, true, body)
    }
  })

  it('asks mihomo to reload only after the membership changed', async () => {
    writeProviderMembers(['台湾-HY2', '台湾-SS', '日本-VLESS', '美国-SS'])
    await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)
    await mail.probe().ensureMailProviderReloaded()
    assert.deepEqual(callsStarting('update:'), [])

    writeProviderMembers(['台湾-SS'])
    await mail.probe().writeSparkleMailProviderFromCache(NODES, PRIORITY)
    await mail.probe().ensureMailProviderReloaded()

    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
  })
})

describe('sparkleMailProbe reloading', () => {
  const mail = useMailRig()

  it('reloads the provider, then warms the mail group', async () => {
    await mail.probe().reloadAndWarmMailGroup()

    assert.deepEqual(world.calls, ['update:sparkle-mail', WARM_UP])
    assert.deepEqual(world.logs, [])
  })

  it('logs a failed reload once, and again only after a reload went through in between', async () => {
    world.updateFailure = { reason: new Error('core down') }
    await mail.probe().reloadAndWarmMailGroup()
    await mail.probe().reloadAndWarmMailGroup()
    assert.deepEqual(world.logs, ['[SparkleMailProbe]: provider reload failed err=core down\n'])
    assert.deepEqual(callsStarting('delay:'), [], 'no warm-up without a reload')

    world.updateFailure = undefined
    await mail.probe().reloadAndWarmMailGroup()
    world.updateFailure = { reason: new Error('core down again') }
    await mail.probe().reloadAndWarmMailGroup()

    assert.equal(world.logs.length, 2)
    assertLog('err=core down again')
  })

  it('reports a failure that is not an Error by its text', async () => {
    world.updateFailure = { reason: 'plain failure' }

    await mail.probe().reloadAndWarmMailGroup()

    assertLog('provider reload failed err=plain failure')
  })

  it('keeps retrying a failed reload until it succeeds', async () => {
    world.updateFailure = { reason: new Error('core down') }
    await mail.probe().reloadAndWarmMailGroup()
    world.updateFailure = undefined
    world.calls = []

    await mail.probe().ensureMailProviderReloaded()
    await mail.probe().ensureMailProviderReloaded()

    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
  })

  it('does nothing when no reload is pending', async () => {
    await mail.probe().ensureMailProviderReloaded()

    assert.deepEqual(world.calls, [])
  })

  it('shrugs off a failed warm-up and does not reload again', async () => {
    world.delayFailure = { reason: new Error('timeout') }

    await mail.probe().reloadAndWarmMailGroup()
    await mail.probe().ensureMailProviderReloaded()

    assert.deepEqual(world.logs, [])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail'])
  })
})

describe('sparkleMailProbe runSparkleMailProbeExclusive', () => {
  const mail = useMailRig()

  it('runs tasks one after another in the order they were submitted', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const first = mail.probe().runSparkleMailProbeExclusive(async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push('first:end')
    })
    const second = mail.probe().runSparkleMailProbeExclusive(async () => {
      order.push('second:start')
    })

    await settle()
    assert.deepEqual(order, ['first:start'])

    releaseFirst()
    await Promise.all([first, second])

    assert.deepEqual(order, ['first:start', 'first:end', 'second:start'])
  })

  it('tells the caller whose task failed, and still runs the next one', async () => {
    const failing = mail.probe().runSparkleMailProbeExclusive(async () => {
      throw new Error('boom')
    })
    let nextRan = false
    const next = mail.probe().runSparkleMailProbeExclusive(async () => {
      nextRan = true
    })

    await assert.rejects(failing, /boom/)
    await next

    assert.equal(nextRan, true)
  })

  it('does not write anything on its own', async () => {
    await mail.probe().runSparkleMailProbeExclusive(async () => undefined)

    assert.equal(cacheFileExists(), false)
    assert.equal(readProviderMembers(), undefined)
  })
})
