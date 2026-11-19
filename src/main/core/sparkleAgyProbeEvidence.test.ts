// [INPUT] sparkleAgyProbe（经 sparkleAgyProbeRig 装配：假 agy CLI / mihomo / 配置 / 生产证据，真实临时文件）· sparkleAgyEvidenceCore 与 sparkleAgyProbeCore 的阈值常量
// [OUTPUT] 生产证据驱动修复、限速、截止时间、探测超时否决权的行为断言
// [POS] 生产流量自己的日志是比探测更直接的证据：判定出口被拒就不等复测直接修复；
// 但日志可能属于别的出口 / 账号级问题，所以修复有限速，且只靠探测超时不足以推翻「线上刚正常工作」的证据。

import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { GATE_CLOSED, GATE_OPEN } from './dedicatedGroupsRig'
import { AGY_EVIDENCE_REPAIR_LIMIT, AGY_EVIDENCE_REPAIR_WINDOW_MS } from './sparkleAgyEvidenceCore'
import { AGY_DUTY_TICK_MS, AGY_PIN_CHECK_INTERVAL_MS } from './sparkleAgyProbeCore'
import {
  ANYTLS,
  HANG,
  HOUR_MS,
  JP1,
  KR1,
  LOCATION,
  MINUTE_MS,
  NOW,
  SG1,
  TW1,
  TW2,
  US1,
  assertLog,
  assertNoLog,
  cacheFileExists,
  cacheKey,
  outcomesByNode,
  productionEvidence,
  readState,
  runBootstrap,
  runDueDuty,
  settle,
  useAgyRig,
  world,
  writeState
} from './sparkleAgyProbeRig'

const agy = useAgyRig()

const logCount = (fragment: string): number =>
  world.logs.filter((line) => line.includes(fragment)).length

/** 已经在位 20 分钟的 pin，复测刚做过：只有生产证据能让这一拍动手。 */
function seedTenuredPin(extra: Record<string, unknown> = {}): void {
  writeState({
    pin: { name: '台湾-1', sinceMs: NOW - 20 * MINUTE_MS },
    lastPinCheckMs: NOW,
    ...extra
  })
}

/** 在位 pin 上最近 3 条地区拒绝（刚好够判定被拒）。 */
function rejectPinInProduction(): void {
  const now = Date.now()
  world.evidence = productionEvidence({
    rejections: [now - 3 * MINUTE_MS, now - 2 * MINUTE_MS, now - MINUTE_MS],
    lastActivityMs: now - MINUTE_MS
  })
}

/** agy 会话刚刚还在经过这个出口干活，且日志里没有任何拒绝。 */
function showPinWorkingInProduction(): void {
  world.evidence = productionEvidence({ lastActivityMs: Date.now() - MINUTE_MS })
}

describe('生产证据判定被拒', () => {
  it('不等复测直接修复：pin 不被探测，只实测候选，并记下判决依据', async () => {
    seedTenuredPin({ lastPinCheckMs: NOW - 10 * MINUTE_MS })
    rejectPinInProduction()

    await runDueDuty(agy())

    assert.deepEqual(world.probedVia, ['台湾-2'], 'pin 没有被探测')
    assert.equal(world.selection, '台湾-2')
    assertLog('pin 台湾-1 trigger=production-evidence records=3 verified=0')
    assertLog('repaired pin 台湾-1 -> 台湾-2')
    const state = readState()
    assert.ok(
      cacheKey(TW1) in (state?.flags as Record<string, number>),
      '被判被拒的 pin 记入被拒记忆'
    )
    assert.deepEqual(state?.evidenceRepairs, [NOW])
    assert.equal(state?.lastPinCheckMs, NOW)
    assert.deepEqual(state?.pin, { name: '台湾-2', sinceMs: NOW })
  })

  it('已经证明 pin 被拒：别的节点即使都记着被拒，也要当最后手段去试，不能留在坏出口上', async () => {
    const flaggedAnHourAgo = Object.fromEntries(
      [TW2, ANYTLS, JP1, KR1, SG1, US1].map((node) => [cacheKey(node), NOW - HOUR_MS])
    )
    seedTenuredPin({ flags: flaggedAnHourAgo })
    rejectPinInProduction()

    await runDueDuty(agy())

    assert.notEqual(world.selection, '台湾-1')
    assertLog('repaired pin 台湾-1 ->')
  })

  it('启动时的强制复测之前也先看证据：被拒的 pin 不会先被探测一遍', async () => {
    seedTenuredPin()
    rejectPinInProduction()

    await runBootstrap(agy())

    assert.deepEqual(world.probedVia, ['台湾-2'])
  })

  it('常驻巡检在下一拍就修复，不等 30 分钟的复测周期', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    agy().startSparkleAgyProbeLoop(GATE_OPEN)

    mock.timers.tick(AGY_DUTY_TICK_MS)
    await settle()

    assert.equal(world.selection, '台湾-2')
  })

  it('agy 组关闭时证据也不触发任何动作', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    agy().startSparkleAgyProbeLoop(GATE_CLOSED)

    mock.timers.tick(AGY_DUTY_TICK_MS)
    await settle()

    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)
  })

  it('少一条记录不够判定：什么都不碰', async () => {
    seedTenuredPin()
    world.evidence = productionEvidence({
      rejections: [NOW - 3 * MINUTE_MS, NOW - MINUTE_MS],
      lastActivityMs: NOW
    })

    await runDueDuty(agy())

    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)
  })

  it('不怪罪新 pin：上任宽限期内落下的记录属于旧出口上在途的请求', async () => {
    writeState({ pin: { name: '台湾-1', sinceMs: NOW - MINUTE_MS }, lastPinCheckMs: NOW })
    world.evidence = productionEvidence({
      rejections: [NOW - 10_000, NOW - 5_000, NOW - 1_000],
      lastActivityMs: NOW
    })

    await runDueDuty(agy())

    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)
  })

  it('用户手动换过出口：判决按组里真实选择的上任时间重判，旧出口的记录不算数', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    world.selection = '日本-1'

    await runDueDuty(agy())

    assert.equal(world.selection, '日本-1')
    assert.equal(world.spawns.length, 0)
    assert.deepEqual(readState()?.pin, { name: '日本-1', sinceMs: NOW })
  })
})

describe('生产证据修复的限速与退避', () => {
  it('全灭退避期内不修复，也不为此去碰订阅', async () => {
    seedTenuredPin({ repairSkipUntilMs: NOW + 10 * MINUTE_MS })
    rejectPinInProduction()

    await runDueDuty(agy())

    assert.equal(world.profileReads, 0)
    assert.equal(world.spawns.length, 0)
  })

  it('证据修复也一无所获：留在原 pin、进入退避，之后每一拍都不再打扰', async () => {
    seedTenuredPin()
    rejectPinInProduction()
    world.defaultOutcome = LOCATION

    await runDueDuty(agy())
    assertLog('WARN no node passed the real agy check')
    const spawned = world.spawns.length
    const reads = world.profileReads

    mock.timers.tick(AGY_DUTY_TICK_MS)
    rejectPinInProduction()
    await runDueDuty(agy())

    assert.equal(world.selection, '台湾-1')
    assert.equal(world.spawns.length, spawned)
    assert.equal(world.profileReads, reads)
  })

  it('一小时内证据修复达到上限就暂停，并只提示一次', async () => {
    seedTenuredPin({ evidenceRepairs: [NOW - 50 * MINUTE_MS, NOW - 40 * MINUTE_MS] })
    rejectPinInProduction()

    await runDueDuty(agy())
    assert.equal(logCount('evidence-triggered repair paused'), 1)
    assert.equal(world.selection, '台湾-2')
    const spawned = world.spawns.length

    // 新 pin 上又出现拒绝记录：限速名额用完，不再修复。
    mock.timers.tick(5 * MINUTE_MS)
    rejectPinInProduction()
    await runDueDuty(agy())

    assert.equal(world.selection, '台湾-2')
    assert.equal(world.spawns.length, spawned)
    assert.equal(logCount('evidence-triggered repair paused'), 1)
  })

  it('最早的一次修复滑出窗口后恢复', async () => {
    seedTenuredPin({
      evidenceRepairs: Array.from(
        { length: AGY_EVIDENCE_REPAIR_LIMIT },
        (_, index) => NOW - AGY_EVIDENCE_REPAIR_WINDOW_MS + (index + 1) * MINUTE_MS
      )
    })
    rejectPinInProduction()
    await runDueDuty(agy())
    assert.equal(world.selection, '台湾-1', '名额用完')

    mock.timers.tick(MINUTE_MS)
    rejectPinInProduction()
    await runDueDuty(agy())

    assert.equal(world.selection, '台湾-2')
  })

  it('先占名额再动手：修复持续抛错也只会重试到上限，不会逐拍重扫', async () => {
    seedTenuredPin()
    world.updateFailure = { reason: new Error('controller is down') }
    const attempts: number[] = []

    for (let run = 0; run < AGY_EVIDENCE_REPAIR_LIMIT + 2; run++) {
      rejectPinInProduction()
      await runDueDuty(agy())
      attempts.push(world.spawns.length)
    }

    const limited = attempts.slice(AGY_EVIDENCE_REPAIR_LIMIT - 1)
    assert.ok(new Set(limited).size === 1, `达到上限后不再有探测: ${attempts.join(',')}`)
    assert.equal((readState()?.evidenceRepairs as number[]).length, AGY_EVIDENCE_REPAIR_LIMIT)
  })
})

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

describe('探测超时的否决权', () => {
  /** 每隔一个复测周期做一次到期巡检，返回每次之后累计的连续超时轮数。 */
  const unknownStreaksOverChecks = async (
    checks: number,
    beforeCheck: () => void = () => undefined
  ): Promise<number[]> => {
    const streaks: number[] = []
    for (let check = 0; check < checks; check++) {
      mock.timers.tick(AGY_PIN_CHECK_INTERVAL_MS)
      beforeCheck()
      await runDueDuty(agy())
      streaks.push(Number(readState()?.pinUnknownStreak))
    }
    return streaks
  }

  it('线上刚证明 pin 在正常工作时，复测超时不累计，也就不会把 pin 拖去扫描', async () => {
    seedTenuredPin()
    outcomesByNode({ '台湾-1': HANG })

    assert.deepEqual(await unknownStreaksOverChecks(3, showPinWorkingInProduction), [0, 0, 0])

    assertNoLog('repair start')
    assert.equal(world.selection, '台湾-1')
  })

  it('证据判决被拒时不给否决权：复测超时照常累计', async () => {
    // 证据修复的限速名额已用完，这一拍只剩到期的复测可做。
    seedTenuredPin({
      lastPinCheckMs: NOW - AGY_PIN_CHECK_INTERVAL_MS,
      evidenceRepairs: [NOW - 3 * MINUTE_MS, NOW - 2 * MINUTE_MS, NOW - MINUTE_MS]
    })
    outcomesByNode({ '台湾-1': HANG })
    rejectPinInProduction()

    await runDueDuty(agy())

    assert.equal(readState()?.pinUnknownStreak, 1)
  })

  it('没有生产证据时仍按连续超时累计，第二次超时才修复', async () => {
    seedTenuredPin()
    outcomesByNode({ '台湾-1': HANG })

    // 第二次超时触发修复，修复成功后累计清零。
    assert.deepEqual(await unknownStreaksOverChecks(2), [1, 0])

    assertLog('repair start')
    assert.equal(world.selection, '台湾-2')
  })

  it('线上的正常证据推翻不了明确的 400：两次都被拒照样修复', async () => {
    seedTenuredPin()
    outcomesByNode({ '台湾-1': LOCATION })

    await unknownStreaksOverChecks(1, showPinWorkingInProduction)

    assert.equal(world.selection, '台湾-2')
    assertLog('verdict=unusable')
  })
})
