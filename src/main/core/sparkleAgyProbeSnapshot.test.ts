import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  cacheKey,
  cacheRecord,
  HANG,
  JP1,
  MINUTE_MS,
  NOW,
  outcomesByNode,
  POOL,
  runBootstrap,
  settle,
  snapshot,
  syncSnapshot,
  TW1,
  TW2,
  useAgyRig,
  world,
  writeCache,
  KR1,
  SG1,
  US1,
  type Proxy
} from './sparkleAgyProbeRig'
import { spyOnTimer } from './timerSpyHarness'

const agy = useAgyRig()

/** 与台湾-1 同名但服务器不同的另一个节点：订阅里出现重名时，面板上只能显示一个结论。 */
const TW1_TWIN: Proxy = { ...TW1, server: 'tw1-twin.example.com' }

describe('getSparkleAgyProbeSnapshot', () => {
  it('is empty before the first round', () => {
    assert.deepEqual(snapshot(), {})
  })

  it('lists the verified nodes with their round-trip time', async () => {
    outcomesByNode({ '台湾-1': { kind: 'ok', rttMs: 42 } })

    await runBootstrap(agy())

    assert.deepEqual(snapshot(), {
      '台湾-1': { rttMs: 42, checkedAt: NOW, state: 'usable' }
    })
  })

  it('hands out a copy that callers cannot use to change the next answer', async () => {
    await runBootstrap(agy())

    const copy = snapshot()
    delete copy['台湾-1']

    assert.deepEqual(Object.keys(snapshot()), ['台湾-1'])
  })

  it('shows nodes that Google rejected together with the evidence', async () => {
    writeCache({ [cacheKey(TW2)]: cacheRecord(false, 77, 5 * MINUTE_MS) })

    await runBootstrap(agy())

    assert.deepEqual(snapshot()['台湾-2'], {
      rttMs: 77,
      checkedAt: NOW - 5 * MINUTE_MS,
      state: 'unusable',
      reason: '地区不支持'
    })
  })

  it('shows why a probe failed instead of leaving the node as untested', async () => {
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())

    assert.deepEqual(snapshot()['台湾-1'], {
      rttMs: 0,
      checkedAt: NOW + 90_000,
      state: 'failed',
      reason: '超时'
    })
  })

  it('forgets a failure once the node is verified again', async () => {
    outcomesByNode({ '台湾-1': HANG })
    await runBootstrap(agy())
    outcomesByNode({})

    await runBootstrap(agy())

    assert.equal(snapshot()['台湾-1'].state, 'usable')
  })

  describe('when two nodes share a name', () => {
    function arrange(usableAgeMs: number, rejectedAgeMs: number): void {
      world.profileProxies = [TW1, TW1_TWIN, TW2, JP1, KR1, SG1, US1]
      world.selection = '日本-1'
      world.members = [...POOL]
      writeCache({
        [cacheKey(TW1)]: cacheRecord(true, 10, usableAgeMs),
        [cacheKey(TW1_TWIN)]: cacheRecord(false, 20, rejectedAgeMs)
      })
    }

    it('shows the verified one when it is the newer conclusion', async () => {
      arrange(MINUTE_MS, 2 * MINUTE_MS)

      await runBootstrap(agy())

      assert.equal(snapshot()['台湾-1'].state, 'usable')
    })

    it('shows the rejection when it is the newer conclusion', async () => {
      arrange(2 * MINUTE_MS, MINUTE_MS)

      await runBootstrap(agy())

      assert.deepEqual(snapshot()['台湾-1'], {
        rttMs: 20,
        checkedAt: NOW - MINUTE_MS,
        state: 'unusable',
        reason: '地区不支持'
      })
    })

    it('shows the rejection when both conclusions are equally new', async () => {
      arrange(MINUTE_MS, MINUTE_MS)

      await runBootstrap(agy())

      assert.equal(snapshot()['台湾-1'].state, 'unusable')
    })
  })

  describe('when a verified sample meets a failed attempt', () => {
    async function runWithSampleAge(sampleAgeMs: number): Promise<void> {
      writeCache({ [cacheKey(TW1)]: cacheRecord(true, 100, sampleAgeMs) })
      outcomesByNode({ '台湾-1': HANG })
      await runBootstrap(agy())
    }

    it('shows the failure when it is newer than the sample', async () => {
      await runWithSampleAge(MINUTE_MS)

      assert.equal(snapshot()['台湾-1'].state, 'failed')
    })

    it('shows the failure when it is exactly as new as the sample', async () => {
      await runWithSampleAge(-90_000)

      assert.equal(snapshot()['台湾-1'].state, 'failed')
    })

    it('keeps the sample when it is newer than the failure', async () => {
      await runWithSampleAge(-120_000)

      assert.equal(snapshot()['台湾-1'].state, 'usable')
    })
  })

  describe('when the subscription changes', () => {
    async function runWithoutTaiwan(): Promise<void> {
      const remaining = [JP1, KR1, SG1, US1]
      world.profileProxies = remaining
      world.selection = '日本-1'
      world.members = remaining.map((proxy) => String(proxy.name))
      outcomesByNode({})
      await runBootstrap(agy())
    }

    it('stops showing the failed probe of a node that is no longer subscribed', async () => {
      outcomesByNode({ '台湾-1': HANG })
      await runBootstrap(agy())
      assert.equal(snapshot()['台湾-1'].state, 'failed')

      await runWithoutTaiwan()

      assert.deepEqual(Object.keys(snapshot()), ['日本-1'])
    })

    it('stops showing the rejection of a node that is no longer subscribed', async () => {
      writeCache({ [cacheKey(TW2)]: cacheRecord(false, 77, 5 * MINUTE_MS) })
      await runBootstrap(agy())
      assert.equal(snapshot()['台湾-2'].state, 'unusable')

      await runWithoutTaiwan()

      assert.deepEqual(Object.keys(snapshot()), ['日本-1'])
    })

    it('never lists a node that has no name', () => {
      const nameless: Proxy = { type: 'ss', server: 'nameless.example.com', port: 8388 }

      syncSnapshot([nameless], new Map([[cacheKey(nameless), cacheRecord(false)]]))

      assert.deepEqual(snapshot(), {})
    })
  })
})

describe('startSparkleAgyProbeLoop', () => {
  const INTERVAL_MS = 30 * MINUTE_MS

  it('registers one 30-minute timer that does not keep the process alive', () => {
    const timers = spyOnTimer('setInterval')
    try {
      agy().startSparkleAgyProbeLoop()
      agy().startSparkleAgyProbeLoop()

      assert.deepEqual(timers.delays, [INTERVAL_MS])
      assert.equal(timers.unrefs(), 1)
    } finally {
      timers.restore()
    }
  })

  it('runs one round every 30 minutes', async () => {
    world.profile = {}
    agy().startSparkleAgyProbeLoop()

    mock.timers.tick(INTERVAL_MS - 1)
    await settle()
    assert.equal(world.profileReads, 0)

    mock.timers.tick(1)
    await settle()
    assert.equal(world.profileReads, 1)

    mock.timers.tick(INTERVAL_MS)
    await settle()
    assert.equal(world.profileReads, 2)
  })

  it('survives a round that cannot even write its log', async () => {
    world.profileFailure = { reason: new Error('profile config unreadable') }
    world.logFailure = true
    agy().startSparkleAgyProbeLoop()

    mock.timers.tick(INTERVAL_MS)
    await settle()
    world.profileFailure = undefined
    world.logFailure = false
    mock.timers.tick(INTERVAL_MS)
    await settle()

    assert.equal(world.spawns.length, 1, 'the next round still runs')
  })
})
