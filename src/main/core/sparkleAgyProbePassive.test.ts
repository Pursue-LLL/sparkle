// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）· sparkleAgyProbeCore 的阈值常量
// [OUTPUT] 拨号失败风暴触发的被动修复入口、内核告警订阅接线的行为断言
// [POS] 被动入口与定时入口共用同一条修复路径：这里钉死入口本身 —— 越过 pin 复测、与定时轮互斥、全灭退避、
// 冷却、订阅幂等、异常自愈。纯判定见 sparkleAgyProbeDialWatch.test.ts，修复扫描的分支见 sparkleAgyProbeRepair.test.ts。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  AGY_DIAL_OUTAGE_THRESHOLD,
  AGY_DIAL_STORM_COOLDOWN_MS,
  AGY_DIAL_STORM_THRESHOLD
} from './sparkleAgyProbeCore'
import {
  AGY_GROUP,
  HANG,
  LOCATION,
  MINUTE_MS,
  assertLog,
  assertNoLog,
  callsStarting,
  dialFailureLine,
  drive,
  emitAlerts,
  outcomesByNode,
  readProviderMembers,
  runDialFailureRepair,
  settle,
  useAgyRig,
  world
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const logCount = (fragment: string): number =>
  world.logs.filter((line) => line.includes(fragment)).length

describe('sparkleAgyProbe 被动入口：修复路径', () => {
  it('越过 pin 复测，直接扫描候选并切到第一个可用节点', async () => {
    outcomesByNode({ '台湾-1': HANG })

    await runDialFailureRepair(agy())

    assert.deepEqual(world.probedVia, ['台湾-2'], 'pin 没有被探测')
    assert.deepEqual(world.killed, [])
    assert.equal(world.selection, '台湾-2')
    assert.deepEqual(readProviderMembers(), ['台湾-2'])
    assertLog(
      'pin 台湾-1 trigger=dial-failures verified=0 model=gemini-3.8-flash-low, repair start'
    )
    assertLog('repaired pin 台湾-1 -> 台湾-2 probed=1 usable=1 pool=1')
  })

  it('全灭后留在原 pin 上并记空轮', async () => {
    world.defaultOutcome = LOCATION

    await runDialFailureRepair(agy())

    assert.equal(world.selection, '台湾-1')
    assertLog('WARN no node passed the real agy check (probed=6); keep 台湾-1 empty_rounds=1')
  })

  it('全灭退避照常生效：紧接着的第二次风暴不产生任何探测，退避期满后才再扫', async () => {
    world.defaultOutcome = LOCATION
    await runDialFailureRepair(agy())
    const spawned = world.spawns.length

    await runDialFailureRepair(agy())
    assert.equal(world.spawns.length, spawned)

    mock.timers.tick(30 * MINUTE_MS)
    await runDialFailureRepair(agy())
    assert.ok(world.spawns.length > spawned)
    assertLog('empty_rounds=2')
  })

  it('订阅在扫描途中被切走：放弃落地，不改写 provider', async () => {
    world.onSpawn = (count) => {
      if (count === 1) {
        world.profile = { current: 'p2' }
      }
    }

    await runDialFailureRepair(agy())

    assertLog('repair start')
    assertNoLog('repaired pin')
    assert.equal(readProviderMembers(), undefined)
    assert.equal(callsStarting('update:').length, 0)
  })

  it('异常只记日志，下一次触发照常修复', async () => {
    world.profileFailure = { reason: new Error('profile config unreadable') }
    await runDialFailureRepair(agy())
    assertLog('[SparkleAgyProbe]: error=profile config unreadable\n')

    world.profileFailure = undefined
    await runDialFailureRepair(agy())

    assert.equal(world.selection, '台湾-2')
  })

  const idleCases: Array<readonly [string, () => void]> = [
    ['没有选订阅', () => (world.profile = {})],
    ['选的是默认订阅', () => (world.profile = { current: 'default' })],
    ['订阅里没有节点', () => (world.profileProxies = [])],
    ['agy 组还没生成', () => (world.groupMissing = true)]
  ]

  for (const [label, arrange] of idleCases) {
    it(`${label}时什么都不做`, async () => {
      arrange()

      await runDialFailureRepair(agy())

      assert.equal(world.spawns.length, 0)
      assert.equal(world.logs.length, 0)
      assert.equal(callsStarting('change:').length, 0)
    })
  }
})

describe('sparkleAgyProbe 被动入口：与定时轮互斥', () => {
  it('定时轮在跑时，被动触发在读取任何配置之前就返回', async () => {
    outcomesByNode({ '台湾-1': HANG })
    const scheduled = agy().bootstrapSparkleAgyProvider()
    await settle()

    await agy().repairSparkleAgyPinOnDialFailures()

    assert.equal(world.profileReads, 1)
    assert.equal(world.spawns.length, 1)
    await drive(scheduled)
  })

  it('被动修复在扫描时，到点的定时轮直接让路', async () => {
    outcomesByNode({ '台湾-2': HANG })
    const passive = agy().repairSparkleAgyPinOnDialFailures()
    await settle()

    await agy().bootstrapSparkleAgyProvider()

    assert.equal(world.profileReads, 1)
    await drive(passive)
    assert.equal(world.selection, '台湾-AnyTLS', '台湾-2 超时后顺位到下一个候选')
  })
})

describe('sparkleAgyProbe 被动入口：内核告警订阅', () => {
  const agyFailure = dialFailureLine(AGY_GROUP)

  /** 订阅触发的修复是脱离调用方的后台任务：让它在假时钟下跑完。 */
  async function drain(): Promise<void> {
    await settle()
    await settle()
  }

  function assertQuiet(): void {
    assert.equal(world.spawns.length, 0)
    assert.equal(world.logs.length, 0)
    assert.deepEqual(world.calls, [])
  }

  it('只订阅一次，重复启动不重复订阅', () => {
    agy().startSparkleAgyProbeLoop()
    agy().startSparkleAgyProbeLoop()

    assert.equal(world.alertListeners.length, 1)
  })

  it('agy 出口的拨号失败达到阈值就触发修复', async () => {
    agy().startSparkleAgyProbeLoop()

    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()

    assertLog('pin 台湾-1 trigger=dial-failures')
    assert.equal(world.selection, '台湾-2')
  })

  it('未到阈值不触发，也不产生任何探测', async () => {
    agy().startSparkleAgyProbeLoop()

    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD - 1)
    await drain()

    assertQuiet()
  })

  it('其它组同时在失败（整网故障）不触发', async () => {
    agy().startSparkleAgyProbeLoop()

    emitAlerts(dialFailureLine('grok 专用', '127.0.0.1:63819(Sparkle)'), AGY_DIAL_OUTAGE_THRESHOLD)
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD * 2)
    await drain()

    assertQuiet()
  })

  it('只数 TCP 拨号失败：健康检查告警与 UDP 失败都不算', async () => {
    agy().startSparkleAgyProbeLoop()

    emitAlerts(`because ${AGY_GROUP} failed multiple times, activate health check`, 100)
    emitAlerts(agyFailure.replace('[TCP]', '[UDP]'), 100)
    await drain()

    assertQuiet()
  })

  it('冷却期内的再次风暴被忽略，冷却期满后风暴仍在才再修复', async () => {
    agy().startSparkleAgyProbeLoop()
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()
    assert.equal(logCount('repaired pin'), 1)

    mock.timers.tick(AGY_DIAL_STORM_COOLDOWN_MS - 1)
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()
    assert.equal(logCount('repaired pin'), 1, '冷却中')

    mock.timers.tick(1)
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()
    assert.equal(logCount('repaired pin'), 2)
  })

  it('一轮修复连日志都写不出去也不外抛，下一次风暴照常修复', async () => {
    world.profileFailure = { reason: new Error('profile config unreadable') }
    world.logFailure = true
    agy().startSparkleAgyProbeLoop()
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()

    world.profileFailure = undefined
    world.logFailure = false
    mock.timers.tick(AGY_DIAL_STORM_COOLDOWN_MS)
    emitAlerts(agyFailure, AGY_DIAL_STORM_THRESHOLD)
    await drain()

    assert.equal(world.selection, '台湾-2')
  })
})
