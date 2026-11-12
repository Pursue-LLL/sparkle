import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  HANG,
  HK1,
  JP1,
  KR1,
  LOCATION,
  MINUTE_MS,
  NODES,
  OK,
  POOL,
  SG1,
  TW1,
  TW2,
  US1,
  assertLog,
  assertNoLog,
  cacheKey,
  callsStarting,
  outcomesByNode,
  readCache,
  readProviderMembers,
  runBootstrap,
  useAgyRig,
  world,
  type Proxy
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

describe('sparkleAgyProbe repair: choosing a replacement', () => {
  it('switches to the first usable candidate when the pin is rejected twice', async () => {
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '台湾-2'])
    assert.equal(world.selection, '台湾-2')
    assert.equal(readCache()[cacheKey(TW1)].usable, false)
    assert.equal(readCache()[cacheKey(TW2)].usable, true)
    assert.deepEqual(readProviderMembers(), ['台湾-2'])
    assertLog(
      'pin 台湾-1 verdict=unusable streak=0 verified=0 model=gemini-3.8-flash-low, repair start'
    )
    assertLog('repaired pin 台湾-1 -> 台湾-2 probed=1 usable=1 pool=1')
  })

  it('walks the candidates in region order and stops at the first usable one', async () => {
    outcomesByNode({ '台湾-1': LOCATION, '台湾-2': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '台湾-2', '日本-1'])
    assert.equal(world.selection, '日本-1')
    assert.deepEqual(readProviderMembers(), ['日本-1'])
    assertLog('probed=2 usable=1 pool=1')
  })

  it('follows the region order configured in the app', async () => {
    world.appConfig = { proxySwitchPriority: ['日本'] }
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '日本-1'])
  })

  it('skips a candidate that mihomo refuses to switch to', async () => {
    world.changeRefused = new Set(['台湾-2'])
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '日本-1'])
    assert.equal(world.selection, '日本-1')
    assert.equal(readCache()[cacheKey(TW2)], undefined, 'an unswitchable node gets no verdict')
    assertLog('probed=1 usable=1 pool=1')
  })

  it('probes at most six candidates per scan', async () => {
    const extra: Proxy[] = ['日本-2', '日本-3', '韩国-2', '新加坡-2', '美国-2'].map((name) => ({
      name,
      type: 'ss',
      server: `${name}.example.com`,
      port: 443
    }))
    world.profileProxies = [...NODES, ...extra]
    world.members = [...POOL, ...extra.map((proxy) => String(proxy.name))]
    world.defaultOutcome = LOCATION

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia.slice(2), [
      '台湾-2',
      '日本-1',
      '日本-2',
      '日本-3',
      '韩国-1',
      '韩国-2'
    ])
    assertLog('(probed=6)')
  })

  it('tries nodes that timed out last time only after the untried ones', async () => {
    outcomesByNode({ '台湾-1': LOCATION, '台湾-2': HANG, '日本-1': OK })
    await runBootstrap(agy())
    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1', '台湾-2', '日本-1'])

    outcomesByNode({ '台湾-1': LOCATION, '台湾-2': HANG, '日本-1': LOCATION, '韩国-1': OK })
    await runBootstrap(agy())

    assert.deepEqual(world.probedVia.slice(4), ['日本-1', '日本-1', '韩国-1'])
    assert.equal(world.selection, '韩国-1')
  })

  it('repairs at once when the pinned node left the subscription', async () => {
    world.selection = '旧节点'
    world.members = [...POOL, '旧节点']

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1'], 'there is no pin to re-test')
    assert.equal(world.selection, '台湾-1')
    assert.deepEqual(readProviderMembers(), ['台湾-1'])
    assertLog('pin 旧节点 verdict=none streak=0 verified=0')
    assertLog('repaired pin 旧节点 -> 台湾-1 probed=1 usable=1 pool=1')
  })

  it('stops the repair when no node of the subscription may use agy', async () => {
    world.profileProxies = [HK1]
    world.selection = '香港-1'
    world.members = ['香港-1']
    world.defaultOutcome = LOCATION

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['香港-1', '香港-1'])
    assertLog('repair start')
    assertNoLog('WARN')
    assert.equal(readProviderMembers(), undefined)
  })
})

describe('sparkleAgyProbe repair: when nothing works', () => {
  it('restores the pin after the scan and records every node as rejected', async () => {
    world.defaultOutcome = LOCATION

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, [
      '台湾-1',
      '台湾-1',
      '台湾-2',
      '日本-1',
      '韩国-1',
      '新加坡-1',
      '美国-1'
    ])
    assert.equal(world.selection, '台湾-1')
    assert.equal(readProviderMembers(), undefined, 'no verified node, so the pool stays whole')
    for (const proxy of [TW1, TW2, JP1, KR1, SG1, US1]) {
      assert.equal(readCache()[cacheKey(proxy)].usable, false)
    }
    assertLog('WARN no node passed the real agy check (probed=5); keep 台湾-1 empty_rounds=1')
  })

  it('backs off 1x, 2x, 3x and then stays at 3x between scans', async () => {
    world.defaultOutcome = LOCATION
    await runBootstrap(agy())

    for (const [index, minutes] of [30, 60, 90, 90].entries()) {
      mock.timers.tick(minutes * MINUTE_MS - 1)
      const before = world.spawns.length
      await runBootstrap(agy())
      assert.equal(world.spawns.length - before, 2, `round ${index + 2} only re-tests the pin`)

      mock.timers.tick(1)
      await runBootstrap(agy())
      assertLog(`empty_rounds=${index + 2}`)
    }
  })

  it('forgets the backoff once the pin works again', async () => {
    world.defaultOutcome = LOCATION
    await runBootstrap(agy())
    world.defaultOutcome = OK
    await runBootstrap(agy())
    assertLog('pin 台湾-1 healthy again, pool=1')

    world.defaultOutcome = LOCATION
    await runBootstrap(agy())

    const warnings = world.logs.filter((line) => line.includes('empty_rounds='))
    assert.deepEqual(
      warnings.map((line) => /empty_rounds=\d+/.exec(line)?.[0]),
      ['empty_rounds=1', 'empty_rounds=1']
    )
  })

  it('does not forget the backoff when the pin merely times out afterwards', async () => {
    world.defaultOutcome = LOCATION
    await runBootstrap(agy())
    const warnings = world.logs.filter((line) => line.includes('WARN')).length
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())
    await runBootstrap(agy())

    assertNoLog('healthy again')
    assert.equal(world.logs.filter((line) => line.includes('repair start')).length, 1)
    assert.equal(world.logs.filter((line) => line.includes('WARN')).length, warnings)
    assert.equal(world.probedVia.length, 7 + 2, 'only the pin was probed while backing off')
  })

  it('names the node it stays on when the rejected pin left the pool', async () => {
    world.outcomes = [LOCATION, LOCATION, { kind: 'error' }]

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-2')
    assertLog('(probed=0); keep 台湾-2 empty_rounds=1')
  })

  it('adopts the best candidate when the group has no selection at all', async () => {
    world.selection = undefined

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 0, 'without a selection no result can be attributed')
    assert.equal(world.selection, '台湾-1')
    assertLog('pin n/a verdict=none')
    assertLog('(probed=0); keep 台湾-1 empty_rounds=1')
  })
})

describe('sparkleAgyProbe repair: interruptions', () => {
  it('abandons the round when the subscription changes during the scan', async () => {
    outcomesByNode({ '台湾-1': LOCATION })
    world.onSpawn = (count) => {
      if (count === 3) {
        world.profile = { current: 'p2' }
      }
    }

    await runBootstrap(agy())

    assertLog('repair start')
    assertNoLog('repaired pin')
    assert.equal(readProviderMembers(), undefined, 'a stale subscription must not rewrite the pool')
    assert.equal(readCache()[cacheKey(TW2)].usable, true, 'what was learned is still kept')
    assert.equal(callsStarting('update:').length, 0)
  })
})
