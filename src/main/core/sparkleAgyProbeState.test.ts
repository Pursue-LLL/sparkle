// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置，真实临时文件）
// [OUTPUT] 巡检在多轮之间的状态演进、日志节奏、缓存落盘时机与展示快照的行为断言
// [POS] 单轮的分支由 sparkleAgyProbe*.test.ts 覆盖；这里钉死跨轮的东西：
// 什么时候算「恢复」、日志每个阶段只记一次、空轮计数何时清零、pin 的超时累计何时重置、缓存何时落盘。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  HANG,
  LOCATION,
  MINUTE_MS,
  POOL,
  TW1,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  cacheRecord,
  callsStarting,
  okAfter,
  outcomesByNode,
  readCache,
  runBootstrap,
  snapshot,
  useAgyRig,
  world,
  writeCache
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const logCount = (fragment: string): number =>
  world.logs.filter((line) => line.includes(fragment)).length

const emptyRoundLogs = (): string[] =>
  world.logs
    .filter((line) => line.includes('WARN no node passed'))
    .map((line) => /empty_rounds=(\d+)/.exec(line)?.[1] ?? '')

/** 整个订阅都拿不到可用节点：pin 连续两次 400，候选也全被拒。 */
async function exhaustOnce(): Promise<void> {
  world.defaultOutcome = LOCATION
  world.outcomeByNode = {}
  await runBootstrap(agy())
}

describe('sparkleAgyProbe 跨轮状态：恢复与退避', () => {
  it('pin 实测可用才算恢复：「恢复」只记一次，空轮计数与退避随之清零', async () => {
    await exhaustOnce()
    assert.deepEqual(emptyRoundLogs(), ['1'])

    world.defaultOutcome = { kind: 'ok' }
    await runBootstrap(agy())
    await runBootstrap(agy())

    assert.equal(logCount('healthy again'), 1)

    // 退避已清零：这一轮立刻重新扫描，空轮从 1 重新数，而不是接着数成 2。
    await exhaustOnce()
    assert.deepEqual(emptyRoundLogs(), ['1', '1'])
  })

  it('修复成功后状态回到健康：之后 pin 正常不再记「恢复」，下一次全灭从第 1 轮计', async () => {
    await exhaustOnce()
    mock.timers.tick(31 * MINUTE_MS)
    world.defaultOutcome = { kind: 'ok' }
    outcomesByNode({ '台湾-1': LOCATION })
    await runBootstrap(agy())
    assert.equal(logCount('repaired pin'), 1)

    world.outcomeByNode = {}
    await runBootstrap(agy())
    assert.equal(logCount('healthy again'), 0)

    await exhaustOnce()
    assert.deepEqual(emptyRoundLogs(), ['1', '1'])
  })

  it('修复扫描全灭后再次修复，会重新记一次「repair start」', async () => {
    await exhaustOnce()
    mock.timers.tick(31 * MINUTE_MS)

    await exhaustOnce()

    assert.equal(logCount('repair start'), 2)
    assert.deepEqual(emptyRoundLogs(), ['1', '2'])
  })

  it('修复没跑完（订阅切走）就不重复记「repair start」', async () => {
    world.defaultOutcome = LOCATION
    for (let round = 0; round < 2; round++) {
      world.profile = { current: 'p1' }
      const base = world.spawns.length
      // pin 的两次确认之后，扫描第一个候选时订阅被切走。
      world.onSpawn = (count) => {
        if (count === base + 3) {
          world.profile = { current: 'p2' }
        }
      }
      await runBootstrap(agy())
    }

    assert.equal(logCount('repair start'), 1)
    assertNoLog('WARN')
  })

  it('扩 provider 之后 mihomo 把组选择落到别处：修复成功后仍会切到选出的节点', async () => {
    world.afterUpdateSelection = '日本-1'
    outcomesByNode({ '台湾-1': LOCATION })

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-2')
    assert.deepEqual(callsStarting('change:').slice(-1), ['change:台湾-2'])
  })

  it('pin 没被判不可用时，重载后 mihomo 改了组选择：会切回 pin', async () => {
    world.members = [...POOL, '旧节点']
    world.afterUpdateSelection = '台湾-2'

    await runBootstrap(agy())

    assert.equal(world.selection, '台湾-1')
  })
})

describe('sparkleAgyProbe 跨轮状态：pin 超时累计', () => {
  it('第二次确认时 agy 启动不了：整轮中止，不计入超时累计', async () => {
    world.outcomes = [LOCATION, { kind: 'throw' }]
    await runBootstrap(agy())
    assert.equal(world.spawns.length, 2)

    outcomesByNode({ '台湾-1': HANG })
    await runBootstrap(agy())

    assertNoLog('repair start')
  })

  it('pin 已不在订阅里：立刻修复，并清掉之前累计的超时轮次', async () => {
    outcomesByNode({ '台湾-1': HANG })
    await runBootstrap(agy())
    assertNoLog('repair start')

    world.outcomeByNode = {}
    world.selection = '旧节点'
    world.members = [...POOL, '旧节点']
    await runBootstrap(agy())
    assert.equal(logCount('repair start'), 1)
    assert.equal(world.selection, '台湾-1')

    outcomesByNode({ '台湾-1': HANG })
    await runBootstrap(agy())

    assert.equal(logCount('repair start'), 1, '累计已清零，一轮超时不触发修复')
  })
})

describe('sparkleAgyProbe 缓存落盘与展示快照', () => {
  it('pin 的结论变了才落盘；结论没变只更新内存', async () => {
    world.defaultOutcome = okAfter(100)
    await runBootstrap(agy())
    assert.equal(readCache()[cacheKey(TW1)].rttMs, 100)

    world.defaultOutcome = okAfter(300)
    await runBootstrap(agy())
    assert.equal(readCache()[cacheKey(TW1)].rttMs, 100)

    world.defaultOutcome = LOCATION
    await runBootstrap(agy())
    assert.equal(readCache()[cacheKey(TW1)].usable, false)
  })

  it('组还没生成：不做任何探测，但缓存里已有的结论照样进展示快照', async () => {
    writeCache({ [cacheKey(TW1)]: cacheRecord(true, 123) })
    world.groupMissing = true

    await runBootstrap(agy())

    assert.deepEqual(snapshot()['台湾-1'], {
      rttMs: 123,
      checkedAt: cacheRecord(true).checkedAt,
      state: 'usable'
    })
    assert.equal(world.spawns.length, 0)
    assertNoLog('error=')
  })

  it('修复扫描里超时的节点当轮就显示为探测失败，而不是「未测」', async () => {
    outcomesByNode({ '台湾-1': LOCATION, '台湾-2': HANG })

    await runBootstrap(agy())

    assert.equal(snapshot()['台湾-2'].state, 'failed')
    assert.equal(snapshot()['台湾-2'].reason, '超时')
    assert.equal(cacheFileExists(), true)
  })
})
