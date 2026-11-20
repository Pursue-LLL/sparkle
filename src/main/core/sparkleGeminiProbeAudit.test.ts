import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { GATE_OPEN } from './dedicatedGroupsRig'
import {
  assertLog,
  AUDIT_INTERVAL_MS,
  cacheKey,
  cacheRecord,
  callsStarting,
  HOUR_MS,
  leaf,
  NODES,
  NOW,
  REFRESH_AFTER_MS,
  settle,
  tickAudit,
  UNUSABLE_PROFILES,
  useGeminiRig,
  world
} from './sparkleGeminiProbeRig'
import { readCache, readProviderOrder, writeCache } from './sparkleGeminiFilesHarness'
import { spyOnTimer } from './timerSpyHarness'

const TW1 = NODES[0]
const TW2 = NODES[1]
const JP1 = NODES[2]
const RESTRICTED = { definitive: true, eligible: false, countryCode: 'ZZ' }
const ELIGIBLE = { definitive: true, eligible: true, countryCode: 'TW' }

describe('sparkleGeminiProbe rebuildAndReloadSparkleFastProvider', () => {
  const gemini = useGeminiRig()

  it('writes nothing when the profile has no nodes', async () => {
    world.profileProxies = []

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.equal(readProviderOrder(), undefined)
    assert.deepEqual(world.calls, [])
  })

  for (const [label, apply] of UNUSABLE_PROFILES) {
    it(`writes nothing when the ${label}`, async () => {
      apply()

      await gemini().rebuildAndReloadSparkleFastProvider()

      assert.equal(readProviderOrder(), undefined)
      assert.deepEqual(world.calls, [])
      assert.deepEqual(world.logs, [])
    })
  }

  it('writes the nodes in region priority order and tells mihomo to reload', async () => {
    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(readProviderOrder(), ['台湾-1', '台湾-2', '日本-1'])
    assert.deepEqual(world.calls, ['update:sparkle-fast', 'detail:自动选择'])
  })

  it('leaves out the nodes known to be region locked', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(false) })

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(readProviderOrder(), ['台湾-2', '日本-1'])
  })

  it('moves the nodes sunk for slow downloads to the end without dropping them', async () => {
    world.sunk = new Set(['台湾-1'])

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(readProviderOrder(), ['台湾-2', '日本-1', '台湾-1'])
  })

  it('orders by the saved latency snapshot when there is one', async () => {
    world.delaySnapshot = new Map([
      ['台湾-1', 300],
      ['台湾-2', 100],
      ['日本-1', 50]
    ])

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(readProviderOrder(), ['台湾-2', '台湾-1', '日本-1'])
  })

  it('follows the region priority from the app config', async () => {
    world.appConfig = { proxySwitchPriority: ['日本'] }

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(readProviderOrder(), ['日本-1', '台湾-1', '台湾-2'])
  })

  it('releases the pin when the pinned node is now region locked', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(false) })
    world.pinned = '台湾-1'

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(callsStarting('unfix:'), ['unfix:自动选择'])
  })

  it('keeps the pin on a node that is still allowed', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(false) })
    world.pinned = '台湾-2'

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(callsStarting('unfix:'), [])
  })

  it('keeps the pin on a node that is only sunk: that is for the quality guard to decide', async () => {
    world.sunk = new Set(['台湾-1'])
    world.pinned = '台湾-1'

    await gemini().rebuildAndReloadSparkleFastProvider()

    assert.deepEqual(callsStarting('unfix:'), [])
  })

  it('logs a failed reload instead of throwing', async () => {
    world.updateFailure = { reason: new Error('reload failed') }

    await gemini().rebuildAndReloadSparkleFastProvider()

    assertLog('rebuild sparkle-fast failed: reload failed')
  })

  it('reports a failure that is not an Error by its text', async () => {
    world.updateFailure = { reason: 'plain failure' }

    await gemini().rebuildAndReloadSparkleFastProvider()

    assertLog('rebuild sparkle-fast failed: plain failure')
  })
})

describe('sparkleGeminiProbe audit', () => {
  const gemini = useGeminiRig()

  it('does nothing when sparkle-fast lists no nodes', async () => {
    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), [])
    assert.equal(world.profileReads, 0, 'nothing to match against, so the profile stays unread')
  })

  it('probes only the live nodes that have no verdict yet', async () => {
    world.leaves = [
      leaf('台湾-1', true),
      leaf('台湾-2', false),
      leaf('日本-1', true),
      leaf('韩国-1', true),
      leaf('日本-2', true, false),
      leaf('美国-1', false, true)
    ]
    writeCache({ [cacheKey(JP1)]: cacheRecord(true), '韩国-1': cacheRecord(true) })

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1', 'lock:美国-1'])
  })

  it('does nothing when every live node already has a verdict', async () => {
    world.leaves = [leaf('台湾-1', true)]
    writeCache({ '台湾-1': cacheRecord(true) })

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), [])
  })

  it('re-verifies an eligible record once it is inside the refresh window and renews it', async () => {
    world.leaves = [leaf('台湾-1', true), leaf('台湾-2', true), leaf('日本-1', true)]
    writeCache({
      [cacheKey(TW1)]: cacheRecord(true, 'TW', REFRESH_AFTER_MS - 1),
      [cacheKey(TW2)]: cacheRecord(true, 'TW', REFRESH_AFTER_MS),
      [cacheKey(JP1)]: cacheRecord(true, 'JP', 12 * HOUR_MS - 1)
    })
    world.verdictOf = () => ELIGIBLE

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-2', 'lock:日本-1'])
    const cache = readCache()
    assert.equal(cache[cacheKey(TW1)].checkedAt, NOW - (REFRESH_AFTER_MS - 1))
    assert.equal(cache[cacheKey(TW2)].checkedAt, NOW)
    assert.equal(cache[cacheKey(JP1)].checkedAt, NOW)
  })

  it('evicts a node whose refreshed verdict turned restricted like any new rejection', async () => {
    world.leaves = [leaf('台湾-1', true)]
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 'TW', REFRESH_AFTER_MS) })
    world.verdictOf = () => RESTRICTED

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.equal(readCache()[cacheKey(TW1)].eligible, false)
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-fast'])
    assertLog('audit finished probed=1 newly_evicted=1')
  })

  it('does not re-verify a restricted record before it expires, however old', async () => {
    world.leaves = [leaf('台湾-1', true)]
    writeCache({ [cacheKey(TW1)]: cacheRecord(false, 'ZZ', 6 * HOUR_MS - 1) })

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), [])
  })

  it('leaves the nodes that were already rejected alone, whichever way the verdict is stored', async () => {
    world.leaves = [leaf('台湾-1', true), leaf('日本-1', true)]
    writeCache({ [cacheKey(TW1)]: cacheRecord(false), '日本-1': cacheRecord(false, 'CN') })

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), [])
    assert.deepEqual(callsStarting('update:'), [])
    assert.ok(!world.logs.some((line) => line.includes('audit finished')))
  })

  it('rebuilds the provider once for the whole batch when some nodes are rejected', async () => {
    world.leaves = [leaf('台湾-1', true), leaf('台湾-2', true)]
    world.verdictOf = (node) => (node === '台湾-1' ? RESTRICTED : ELIGIBLE)

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1', 'lock:台湾-2'])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-fast'])
    assert.deepEqual(readProviderOrder(), ['台湾-2', '日本-1'])
    assertLog('audit finished probed=2 newly_evicted=1')
  })

  it('does not touch the provider when nothing was rejected', async () => {
    world.leaves = [leaf('台湾-1', true), leaf('台湾-2', true)]
    world.verdictOf = () => ELIGIBLE

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('update:'), [])
    assert.ok(!world.logs.some((line) => line.includes('audit finished')))
  })

  it('does not count a probe without a verdict as a rejection', async () => {
    world.leaves = [leaf('台湾-1', true)]
    world.verdictOf = () => ({ definitive: false, eligible: false })

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('update:'), [])
  })

  it('logs a failure and can run again afterwards', async () => {
    world.providersFailure = { reason: new Error('controller down') }
    await gemini().bootstrapSparkleGeminiRegionAudit()
    assertLog('audit error=controller down')

    world.providersFailure = undefined
    world.leaves = [leaf('台湾-1', true)]
    await gemini().bootstrapSparkleGeminiRegionAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })

  it('reports a failure that is not an Error by its text', async () => {
    world.providersFailure = { reason: 'plain failure' }

    await gemini().bootstrapSparkleGeminiRegionAudit()

    assertLog('audit error=plain failure')
  })

  it('ignores a second audit while one is still running', async () => {
    world.leaves = [leaf('台湾-1', true)]
    let release: () => void = () => undefined
    world.onProbe = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const first = gemini().bootstrapSparkleGeminiRegionAudit()
    await settle()
    await gemini().bootstrapSparkleGeminiRegionAudit()
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])

    release()
    await first
  })
})

describe('sparkleGeminiProbe audit loop', () => {
  const gemini = useGeminiRig()

  it('audits every half hour', async () => {
    world.leaves = [leaf('台湾-1', true)]
    gemini().startSparkleGeminiRegionAuditLoop(GATE_OPEN)

    await tickAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })

  it('waits out the full half hour before the first round', async () => {
    world.leaves = [leaf('台湾-1', true)]
    gemini().startSparkleGeminiRegionAuditLoop(GATE_OPEN)

    mock.timers.tick(AUDIT_INTERVAL_MS - 1)
    await settle()
    assert.deepEqual(callsStarting('lock:'), [])

    mock.timers.tick(1)
    await settle()
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })

  it('registers one timer that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      gemini().startSparkleGeminiRegionAuditLoop(GATE_OPEN)
      gemini().startSparkleGeminiRegionAuditLoop(GATE_OPEN)

      assert.deepEqual(timers.delays, [AUDIT_INTERVAL_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })

  it('skips every round while the gemini group is off and audits again once it is back on', async () => {
    world.leaves = [leaf('台湾-1', true)]
    let open = false
    gemini().startSparkleGeminiRegionAuditLoop(async () => open)

    await tickAudit()
    await tickAudit()
    assert.deepEqual(world.calls, [])

    open = true
    await tickAudit()
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })

  it('treats an unreadable switch as a skipped round and recovers on the next one', async () => {
    world.leaves = [leaf('台湾-1', true)]
    let broken = true
    gemini().startSparkleGeminiRegionAuditLoop(async () => {
      if (broken) throw new Error('config unreadable')
      return true
    })

    await tickAudit()
    assert.deepEqual(world.calls, [])

    broken = false
    await tickAudit()
    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })

  it('keeps going after a failed round', async () => {
    world.providersFailure = { reason: new Error('controller down') }
    gemini().startSparkleGeminiRegionAuditLoop(GATE_OPEN)
    await tickAudit()

    world.providersFailure = undefined
    world.leaves = [leaf('台湾-1', true)]
    await tickAudit()

    assert.deepEqual(callsStarting('lock:'), ['lock:台湾-1'])
  })
})
