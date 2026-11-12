import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGY_GROUP,
  HANG,
  HK1,
  LOCATION,
  NOW,
  POOL,
  TW1,
  TW2,
  assertLog,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  expireHangingProbe,
  okAfter,
  outcomesByNode,
  readCache,
  readProviderMembers,
  runBootstrap,
  settle,
  useAgyRig,
  world,
  writeCache,
  type CliOutcome
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

describe('sparkleAgyProbe bootstrap: nothing to probe', () => {
  const idleCases: Array<readonly [string, () => void]> = [
    ['no subscription is selected', () => (world.profile = {})],
    ['the default profile is selected', () => (world.profile = { current: 'default' })],
    ['the subscription has no nodes', () => (world.profileProxies = [])]
  ]

  for (const [label, arrange] of idleCases) {
    it(`does nothing when ${label}`, async () => {
      arrange()

      await runBootstrap(agy())

      assert.deepEqual(world.calls, [])
      assert.equal(world.spawns.length, 0)
      assert.equal(cacheFileExists(), false)
      assert.equal(world.logs.length, 0)
    })
  }

  it('waits for the group to exist before probing or writing a provider', async () => {
    world.groupMissing = true

    await runBootstrap(agy())

    assert.deepEqual(world.calls, [`detail:${AGY_GROUP}`])
    assert.equal(world.spawns.length, 0)
    assert.equal(readProviderMembers(), undefined)
  })
})

describe('sparkleAgyProbe bootstrap: healthy pin', () => {
  it('keeps the pin and narrows the pool to the verified node', async () => {
    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1'])
    assert.equal(world.selection, '台湾-1')
    assert.deepEqual(readProviderMembers(), ['台湾-1'])
    assert.equal(callsStarting('update:').length, 1)
    assert.equal(callsStarting('change:').length, 0)
    assert.deepEqual(readCache()[cacheKey(TW1)], { usable: true, rttMs: 1, checkedAt: NOW })
    assert.equal(world.logs.length, 0)
  })

  it('asks the cheap model and gives agy a timeout shorter than the probe budget', async () => {
    await runBootstrap(agy())

    const [spawned] = world.spawns
    assert.equal(spawned.args[spawned.args.indexOf('--model') + 1], 'gemini-3.8-flash-low')
    assert.equal(spawned.args[spawned.args.indexOf('--print-timeout') + 1], '85s')
  })

  it('does not rewrite or reload a provider that already matches the pool', async () => {
    world.members = ['台湾-1']

    await runBootstrap(agy())

    assert.equal(readProviderMembers(), undefined)
    assert.equal(callsStarting('update:').length, 0)
  })

  it('re-tests only the pin on the next round', async () => {
    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1'])
    assert.equal(callsStarting('update:').length, 1)
    assert.equal(callsStarting('close:').length, 1, 'same selection, nothing to cut')
  })

  it('cuts old connections once the selection was changed from outside', async () => {
    await runBootstrap(agy())
    world.selection = '台湾-2'
    world.members = [...POOL]

    await runBootstrap(agy())

    assert.equal(callsStarting('close:').length, 2)
    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-2'])
  })

  it('confirms a location rejection once before judging the pin', async () => {
    world.outcomes = [LOCATION, okAfter(50)]

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-1', '台湾-1'])
    assert.equal(readCache()[cacheKey(TW1)].usable, true)
    assertNoLog('repair start')
    assert.equal(callsStarting('change:').length, 0)
  })

  it('orders a verified pool by region then by round-trip time and keeps the pin', async () => {
    writeCache({
      [cacheKey(TW1)]: cacheRecord(true, 300),
      [cacheKey(TW2)]: cacheRecord(true, 100)
    })
    outcomesByNode({ '台湾-1': okAfter(300) })

    await runBootstrap(agy())

    assert.deepEqual(readProviderMembers(), ['台湾-2', '台湾-1'])
    assert.equal(world.selection, '台湾-1', 'a faster node must not steal a healthy pin')
    assert.equal(callsStarting('change:').length, 0)
  })

  it('leaves the pool alone when no node of the subscription may use agy', async () => {
    world.profileProxies = [HK1]
    world.selection = '香港-1'
    world.members = ['香港-1']

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['香港-1'])
    assert.equal(readProviderMembers(), undefined)
    assert.equal(world.selection, '香港-1')
  })

  it('moves off a pin that is no longer allowed to use agy', async () => {
    world.selection = '香港-1'
    world.members = [...POOL, '香港-1']

    await runBootstrap(agy())

    assert.deepEqual(readProviderMembers(), POOL)
    assert.equal(world.selection, '台湾-1')
  })
})

describe('sparkleAgyProbe bootstrap: unreliable probes', () => {
  it('tolerates one timeout and repairs after the second', async () => {
    outcomesByNode({ '台湾-1': HANG })

    await runBootstrap(agy())
    assertNoLog('repair start')
    assert.deepEqual(world.killed, ['SIGKILL'])

    await runBootstrap(agy())
    assertLog('pin 台湾-1 verdict=unknown streak=2 verified=0 model=gemini-3.8-flash-low')
    assertLog('repaired pin 台湾-1 -> 台湾-2 probed=1 usable=1 pool=1')
    assert.equal(world.selection, '台湾-2')
    assert.deepEqual(world.killed, ['SIGKILL', 'SIGKILL'])
  })
})

describe('sparkleAgyProbe bootstrap: unreachable CLI', () => {
  const unreachable: Array<readonly [string, CliOutcome]> = [
    ['cannot be started', { kind: 'error' }],
    ['fails to spawn', { kind: 'throw' }]
  ]

  for (const [label, outcome] of unreachable) {
    it(`abandons the round without side effects when the agy CLI ${label}`, async () => {
      world.defaultOutcome = outcome

      await runBootstrap(agy())

      assert.equal(world.spawns.length, 1)
      assert.equal(cacheFileExists(), false)
      assert.equal(world.logs.length, 0)
      assert.equal(callsStarting('update:').length, 0)

      await runBootstrap(agy())
      assert.equal(world.spawns.length, 2, 'a failed round must not block later rounds')
    })
  }

  it('abandons the round when the CLI vanishes while confirming a rejection', async () => {
    world.outcomes = [LOCATION, { kind: 'error' }]

    await runBootstrap(agy())

    assert.equal(world.spawns.length, 2)
    assert.equal(cacheFileExists(), false)
    assert.equal(world.logs.length, 0)
  })
})

describe('sparkleAgyProbe bootstrap: overlapping calls and failures', () => {
  it('ignores a call that arrives while the previous round is still running', async () => {
    outcomesByNode({ '台湾-1': HANG })
    const running = agy().bootstrapSparkleAgyProvider()
    await settle()

    await agy().bootstrapSparkleAgyProvider()

    assert.equal(world.profileReads, 1, 'the second call must return before reading anything')
    assert.equal(world.spawns.length, 1)
    assert.ok(expireHangingProbe())
    await running

    outcomesByNode({})
    await runBootstrap(agy())
    assert.equal(world.spawns.length, 2, 'the next round runs normally')
  })

  it('logs an unexpected failure and recovers on the next round', async () => {
    world.profileFailure = { reason: new Error('profile config unreadable') }
    await runBootstrap(agy())
    assertLog('[SparkleAgyProbe]: error=profile config unreadable\n')

    world.profileFailure = { reason: 'plain failure' }
    await runBootstrap(agy())
    assertLog('[SparkleAgyProbe]: error=plain failure\n')

    world.profileFailure = undefined
    await runBootstrap(agy())
    assert.equal(world.spawns.length, 1)
  })

  it('treats a provider reload failure as an error and retries the write next time', async () => {
    world.updateFailure = { reason: new Error('mihomo rejected the provider') }

    await runBootstrap(agy())
    assertLog('[SparkleAgyProbe]: error=mihomo rejected the provider\n')
    assert.deepEqual(readProviderMembers(), ['台湾-1'])

    world.updateFailure = undefined
    await runBootstrap(agy())
    assert.equal(callsStarting('update:').length, 2, 'the pool was still not applied, so retry')
  })
})
