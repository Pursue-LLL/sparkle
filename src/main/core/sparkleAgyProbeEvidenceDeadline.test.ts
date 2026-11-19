// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置 / 生产证据，真实临时文件）· sparkleAgyProbeScenes · sparkleAgyProbeCore 的复测间隔常量
// [OUTPUT] 截止时间内的证据修复与 pin 复测的行为断言
// [POS] 无头调度进程的巡检有截止时间：离截止不够发一次探测就不动手，被截断的扫描不当作全灭，
// 复测没做完不能算数，否则下一次巡检会被推迟整整一个周期。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { AGY_PIN_CHECK_INTERVAL_MS } from './sparkleAgyProbeCore'
import {
  HANG,
  LOCATION,
  NOW,
  assertLog,
  assertNoLog,
  cacheFileExists,
  outcomesByNode,
  readState,
  runDueDuty,
  useAgyRig,
  world
} from './sparkleAgyProbeRig'
import { rejectPinInProduction, seedTenuredPin } from './sparkleAgyProbeScenes'

const agy = useAgyRig()

describe('截止时间内的修复', () => {
  it('离截止不够发一次探测：什么都不做，名额退还，复测时间不推进', async () => {
    seedTenuredPin()
    rejectPinInProduction()

    await runDueDuty(agy(), NOW + 20_000)

    assert.equal(world.spawns.length, 0)
    assertNoLog('repair start')
    assert.deepEqual(readState()?.evidenceRepairs, [])
    assert.equal(readState()?.lastPinCheckMs, NOW)
  })

  it('扫描里的每次探测超时都收紧到截止之前', async () => {
    seedTenuredPin()
    rejectPinInProduction()

    await runDueDuty(agy(), NOW + 50_000)

    const args = world.spawns[0]!.args
    assert.equal(args[args.indexOf('--print-timeout') + 1], '45s')
  })

  it('时间只够一次探测：第一个候选超时后不再开新的，也不把这当成「全灭」去拉长退避', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    outcomesByNode({ '台湾-2': HANG })

    await runDueDuty(agy(), NOW + 60_000)

    assert.equal(world.spawns.length, 1)
    assert.equal(world.selection, '台湾-1')
    assertLog('scan cut short by the deadline (probed=0); keep 台湾-1')
    assertNoLog('WARN no node passed')
    assert.equal(readState()?.emptyRounds, 0)
    assert.equal(readState()?.repairSkipUntilMs, 0)
  })

  it('被截断的扫描下次接着扫：已试的节点排到后面，不会每次都从同一个候选开始', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    outcomesByNode({ '台湾-2': HANG })
    await runDueDuty(agy(), NOW + 60_000)
    assert.deepEqual(world.probedVia, ['台湾-2'])

    rejectPinInProduction()
    await runDueDuty(agy())

    assert.deepEqual(world.probedVia, ['台湾-2', '台湾-AnyTLS'])
    assert.equal(world.selection, '台湾-AnyTLS')
  })
})

describe('截止时间内的 pin 复测', () => {
  it('判定要修复、却没时间修：这次复测不算数，下一次照样到期', async () => {
    seedTenuredPin({ lastPinCheckMs: NOW - AGY_PIN_CHECK_INTERVAL_MS, pinUnknownStreak: 1 })
    outcomesByNode({ '台湾-1': HANG })

    await runDueDuty(agy(), NOW + 100_000)

    assert.equal(world.spawns.length, 1, '只有 pin 的那次探测')
    assert.equal(readState()?.pinUnknownStreak, 2)
    assert.equal(readState()?.lastPinCheckMs, NOW - AGY_PIN_CHECK_INTERVAL_MS)
    assertNoLog('repair start')
  })

  it('第一次探测被拒、却来不及再确认：不下结论，也不记入被拒记忆', async () => {
    seedTenuredPin({ lastPinCheckMs: NOW - AGY_PIN_CHECK_INTERVAL_MS })
    world.outcomes = [LOCATION]
    // 第一次探测期间过去了 70 秒：离截止只剩 25 秒，不够再发第二次。
    world.onSpawn = (count) => {
      if (count === 1) {
        queueMicrotask(() => mock.timers.tick(70_000))
      }
    }

    await runDueDuty(agy(), NOW + 95_000)

    assert.equal(world.spawns.length, 1)
    assert.deepEqual(readState()?.flags ?? {}, {})
    assert.equal(cacheFileExists(), false)
    assert.equal(readState()?.lastPinCheckMs, NOW - AGY_PIN_CHECK_INTERVAL_MS)
  })
})
