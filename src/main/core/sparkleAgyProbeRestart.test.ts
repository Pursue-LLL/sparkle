// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）· restartProbe 模拟进程重启
// [OUTPUT] 巡检编排状态跨进程延续的行为断言
// [POS] 无头调度任务每次都是新进程：退避、超时累计与已试记录若只活在内存里，一轮结束就丢，
// 同一批坏节点会被每一轮反复重试。这里钉死「重启之后这些状态仍然生效」，以及状态写盘失败不拖垮巡检。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  HANG,
  LOCATION,
  MINUTE_MS,
  TW1,
  TW2,
  assertLog,
  assertNoLog,
  blockStateWrites,
  cacheKey,
  outcomesByNode,
  readState,
  restartProbe,
  runBootstrap,
  useAgyRig,
  world
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const logCount = (fragment: string): number =>
  world.logs.filter((line) => line.includes(fragment)).length

const emptyRoundLogs = (): string[] =>
  world.logs
    .filter((line) => line.includes('WARN no node passed'))
    .map((line) => /empty_rounds=(\d+)/.exec(line)?.[1] ?? '')

describe('sparkleAgyProbe 状态跨进程延续', () => {
  it('全灭后的退避在重启后仍然生效，到期后照常恢复修复', async () => {
    world.defaultOutcome = LOCATION
    await runBootstrap(agy())
    assert.deepEqual(emptyRoundLogs(), ['1'])
    const spawnsBeforeRestart = world.spawns.length

    await runBootstrap(restartProbe())

    assert.equal(world.spawns.length, spawnsBeforeRestart + 2, '只有 pin 的两次确认，不再扫描候选')
    assert.equal(logCount('repair start'), 1)
    assert.deepEqual(emptyRoundLogs(), ['1'])

    mock.timers.tick(31 * MINUTE_MS)
    await runBootstrap(restartProbe())

    assert.equal(logCount('repair start'), 2)
    assert.deepEqual(emptyRoundLogs(), ['1', '2'])
  })

  it('pin 连续超时的轮数跨重启累计：重启后的第二次超时才触发修复', async () => {
    outcomesByNode({ '台湾-1': HANG })
    await runBootstrap(agy())
    assertNoLog('repair start')

    await runBootstrap(restartProbe())

    assert.equal(logCount('repair start'), 1)
  })

  it('被打断的修复扫描试过哪些节点会落盘，留给下一个进程', async () => {
    world.defaultOutcome = LOCATION
    // pin 的两次确认之后，扫描第一个候选时订阅被切走：这一轮不落地，但试过的节点必须记下来。
    world.onSpawn = (count) => {
      if (count === 3) {
        world.profile = { current: 'p2' }
      }
    }

    await runBootstrap(agy())

    const attempts = readState()?.attempts as Record<string, number>
    assert.ok(cacheKey(TW2) in attempts, '第一个候选已试')
    assert.ok(!(cacheKey(TW1) in attempts), 'pin 自己不是候选')
  })

  it('状态写不进磁盘：只记一条日志，本轮结果不受影响，下一轮照常运行', async () => {
    blockStateWrites()
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-2')
    assertLog('state save failed')
    assertNoLog('error=')

    const spawnsBefore = world.spawns.length
    await runBootstrap(agy())
    assert.equal(world.spawns.length, spawnsBefore + 1, '上一轮已释放，没有卡在「进行中」')
  })
})
