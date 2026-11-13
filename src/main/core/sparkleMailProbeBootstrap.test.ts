import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  ANYTLS_TW,
  assertLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  HOUR_MS,
  HY2_TW,
  readCache,
  readProviderMembers,
  settle,
  SS_TW,
  SS_US,
  useMailRig,
  VLESS_JP,
  world,
  writeCache
} from './sparkleMailProbeRig'
import { spyOnTimer } from './timerSpyHarness'

const WARM_UP = 'delay:📧 邮件专用:https://mail.google.com'

describe('sparkleMailProbe bootstrap without anything to probe', () => {
  const mail = useMailRig()

  it('does nothing when the default profile is selected', async () => {
    world.profile = { current: 'default' }

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(world.calls, [])
    assert.deepEqual(world.logs, [])
    assert.equal(readProviderMembers(), undefined)
  })

  it('does nothing when the profile has no nodes', async () => {
    world.profileProxies = []

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(world.calls, [])
    assert.equal(readProviderMembers(), undefined)
    assert.equal(world.appConfigReads, 0, 'no nodes, so no reason to read the app config')
  })

  it('logs a config failure instead of throwing', async () => {
    world.profileError = true

    await mail.probe().bootstrapSparkleMailProvider()

    assertLog('[SparkleMailProbe]: error=profile config unreadable')
  })

  it('never probes unnamed nodes, and probes names without their padding', async () => {
    world.profileProxies = [
      ANYTLS_TW,
      { type: 'ss', server: 'nameless.example.com' },
      { name: '   ', type: 'ss', server: 'blank.example.com' },
      { ...SS_TW, name: ' 台湾-SS ' }
    ]

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-AnyTLS', 'probe:台湾-SS'])
  })

  it('probes a node whose name is a single character', async () => {
    world.profileProxies = [{ name: 'X', type: 'ss', server: 'x.example.com', port: 1 }]

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), ['probe:X'])
  })
})

describe('sparkleMailProbe bootstrap from the cache', () => {
  const mail = useMailRig()

  it('publishes the verified nodes, then probes the one node the cache does not know', async () => {
    writeCache(
      Object.fromEntries(
        [HY2_TW, VLESS_JP, SS_TW, SS_US].map((proxy) => [cacheKey(proxy), cacheRecord(true, 60)])
      )
    )

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-AnyTLS'])
    // 新探测的 AnyTLS 往返 50ms，比缓存里 60ms 的已验证节点更靠前。
    assert.deepEqual(readProviderMembers(), [
      '台湾-AnyTLS',
      '台湾-HY2',
      '台湾-SS',
      '日本-VLESS',
      '美国-SS'
    ])
    assert.deepEqual(world.calls, [
      'update:sparkle-mail',
      WARM_UP,
      'probe:台湾-AnyTLS',
      'update:sparkle-mail',
      WARM_UP
    ])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: loaded 4 verified mail nodes from cache active_pool=4\n',
      '[SparkleMailProbe]: full-tier probed=1 newly_alive=1 active_pool=5\n'
    ])
  })

  it('probes the one node the cache does not know when every cached node is dead', async () => {
    writeCache(
      Object.fromEntries(
        [HY2_TW, VLESS_JP, SS_TW, SS_US].map((proxy) => [cacheKey(proxy), cacheRecord(false)])
      )
    )

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-AnyTLS'])
    assert.deepEqual(world.calls, ['probe:台湾-AnyTLS', 'update:sparkle-mail', WARM_UP])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: full-tier probed=1 newly_alive=1 active_pool=1\n'
    ])
    assert.deepEqual(readProviderMembers(), ['台湾-AnyTLS'])
  })

  it('probes again the nodes whose record expired, and only those', async () => {
    world.profileProxies = [HY2_TW, SS_TW]
    writeCache({
      [cacheKey(HY2_TW)]: cacheRecord(true, 60, HOUR_MS),
      [cacheKey(SS_TW)]: cacheRecord(true, 60, 13 * HOUR_MS)
    })

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-SS'])
    assertLog('loaded 1 verified mail nodes from cache active_pool=1')
    assertLog('full-tier probed=1 newly_alive=1 active_pool=2')
  })
})

describe('sparkleMailProbe bootstrap probing', () => {
  const mail = useMailRig()

  it('probes the Hysteria2 and VLESS nodes first, publishing after each tier', async () => {
    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(callsStarting('probe:'), [
      'probe:台湾-HY2',
      'probe:日本-VLESS',
      'probe:台湾-SS',
      'probe:美国-SS',
      'probe:台湾-AnyTLS'
    ])
    assert.deepEqual(callsStarting('update:'), ['update:sparkle-mail', 'update:sparkle-mail'])
    assert.deepEqual(readProviderMembers(), [
      '台湾-HY2',
      '台湾-SS',
      '台湾-AnyTLS',
      '日本-VLESS',
      '美国-SS'
    ])
    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: fast-tier probed=2 newly_alive=2 active_pool=2\n',
      '[SparkleMailProbe]: full-tier probed=3 newly_alive=3 active_pool=5\n'
    ])
    assert.equal(Object.keys(readCache()).length, 5)
  })

  it('has the first tier on disk and in mihomo before the second one starts', async () => {
    let published: string[] | undefined
    let savedKeys: string[] = []
    let reloadsBefore = 0
    world.onPortProbe = (node) => {
      if (node === '台湾-SS') {
        published = readProviderMembers()
        savedKeys = Object.keys(readCache())
        reloadsBefore = callsStarting('update:').length
      }
    }

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(published, ['台湾-HY2', '日本-VLESS'])
    assert.deepEqual(savedKeys.sort(), [cacheKey(HY2_TW), cacheKey(VLESS_JP)].sort())
    assert.equal(reloadsBefore, 1)
  })

  it('records the dead nodes of both tiers and keeps them out of the provider', async () => {
    world.portVerdictOf = (node) =>
      node === '台湾-HY2' || node === '台湾-SS'
        ? { alive: false, rttMs: 0 }
        : { alive: true, rttMs: 60 }

    await mail.probe().bootstrapSparkleMailProvider()

    assert.equal(readCache()[cacheKey(HY2_TW)].alive, false)
    assert.equal(readCache()[cacheKey(SS_TW)].alive, false)
    assert.deepEqual(readProviderMembers(), ['台湾-AnyTLS', '日本-VLESS', '美国-SS'])
    assertLog('fast-tier probed=2 newly_alive=1 active_pool=1')
    assertLog('full-tier probed=3 newly_alive=2 active_pool=3')
  })

  it('only reports the fast tier when nothing else is unprobed', async () => {
    world.profileProxies = [HY2_TW]

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: fast-tier probed=1 newly_alive=1 active_pool=1\n'
    ])
  })

  it('only reports the full tier when there is no Hysteria2 or VLESS node', async () => {
    world.profileProxies = [SS_TW]

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(world.logs, [
      '[SparkleMailProbe]: full-tier probed=1 newly_alive=1 active_pool=1\n'
    ])
  })

  it('stamps every verdict with the time it was taken', async () => {
    world.profileProxies = [SS_TW]
    world.portVerdictOf = () => ({ alive: true, rttMs: 42 })

    await mail.probe().bootstrapSparkleMailProvider()

    assert.deepEqual(readCache()[cacheKey(SS_TW)], {
      alive: true,
      rttMs: 42,
      checkedAt: Date.now()
    })
  })

  it('keeps going when the core refuses to reload, logging that once', async () => {
    world.updateFailure = { reason: new Error('core down') }

    await mail.probe().bootstrapSparkleMailProvider()

    assert.equal(world.logs.filter((line) => line.includes('provider reload failed')).length, 1)
    assertLog('fast-tier probed=2')
    assertLog('full-tier probed=3')
    assert.deepEqual(readProviderMembers(), [
      '台湾-HY2',
      '台湾-SS',
      '台湾-AnyTLS',
      '日本-VLESS',
      '美国-SS'
    ])
  })
})

describe('sparkleMailProbe bootstrap failures', () => {
  const mail = useMailRig()

  it('does not mistake a probe channel failure for a dead node', async () => {
    world.portProbeFailure = { reason: new Error('listener down') }

    await mail.probe().bootstrapSparkleMailProvider()

    assertLog('[SparkleMailProbe]: error=listener down')
    assert.equal(cacheFileExists(), false)
    assert.equal(readProviderMembers(), undefined)
  })

  it('reports a failure that is not an Error by its text', async () => {
    world.portProbeFailure = { reason: 'plain failure' }

    await mail.probe().bootstrapSparkleMailProvider()

    assertLog('[SparkleMailProbe]: error=plain failure')
  })

  it('can run again after a failed round', async () => {
    world.portProbeFailure = { reason: new Error('listener down') }
    await mail.probe().bootstrapSparkleMailProvider()
    world.portProbeFailure = undefined
    world.calls = []

    await mail.probe().bootstrapSparkleMailProvider()

    assert.equal(callsStarting('probe:').length, 5)
  })

  it('ignores a second bootstrap while one is still running', async () => {
    world.profileProxies = [SS_TW]
    let release: () => void = () => undefined
    world.onPortProbe = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })

    const first = mail.probe().bootstrapSparkleMailProvider()
    await settle()
    await mail.probe().bootstrapSparkleMailProvider()
    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-SS'])

    release()
    await first

    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-SS'])
  })
})

describe('sparkleMailProbe hourly loop', () => {
  const mail = useMailRig()

  it('runs a bootstrap every hour, and not a moment earlier', async () => {
    world.profileProxies = [SS_TW]
    mail.probe().startSparkleMailProbeLoop()

    mock.timers.tick(HOUR_MS - 1)
    await settle()
    assert.deepEqual(callsStarting('probe:'), [])

    mock.timers.tick(1)
    await settle()
    assert.deepEqual(callsStarting('probe:'), ['probe:台湾-SS'])

    world.calls = []
    mock.timers.tick(HOUR_MS)
    await settle()
    assert.deepEqual(callsStarting('probe:'), [], 'the node has a fresh verdict by now')
    assertLog('loaded 1 verified mail nodes from cache')
  })

  it('registers one hourly timer that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      mail.probe().startSparkleMailProbeLoop()
      mail.probe().startSparkleMailProbeLoop()

      assert.deepEqual(timers.delays, [HOUR_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })
})
