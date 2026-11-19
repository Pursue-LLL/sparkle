// [INPUT] 当前订阅节点 · 巡检状态（sparkleAgyState）· 生产证据（sparkleAgyEvidence）· pin 复测（sparkleAgyPinCheck）· 修复扫描（sparkleAgyRepair）·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         dedicatedGroups::runWhenEnabled (POS: 可开关专用组注册表与开关解析) ·
//         mihomoApi::subscribeMihomoAlerts (POS: mihomo 控制器访问层) ·
//         sparkleAgyEvidence::collectAgyProductionEvidence (POS: agy 出口生产证据采集) ·
//         sparkleAgyEvidenceCore::canRepairOnEvidence/judgeAgyPinByProduction/recentEvidenceRepairs (POS: agy 出口生产证据) ·
//         sparkleAgyPinCheck::checkPin/keepPin (POS: agy pin 就地复测) ·
//         sparkleAgyProbeCore::AGY_DUTY_TICK_MS/createAgyDialFailureWatch/isPinCheckDue/shouldRepairAgyPin (POS: agy 巡检状态机) ·
//         sparkleAgyRepair::repairPin (POS: agy 修复扫描) · sparkleAgyRound::openRound/flagPin/AgyRound (POS: agy 一轮巡检上下文) ·
//         utils/errorMessage::describeError (POS: 失败路径上的异常文本化) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] bootstrapSparkleAgyProvider · runSparkleAgyDueDuty · repairSparkleAgyPinOnDialFailures · startSparkleAgyProbeLoop
// [POS] 用官方 agy CLI 的真实请求给节点定性：200 = 可用，地区被拒（生成请求的 400 `User location is not supported`，
// 或 aicode 的 `LOCATION_NOT_ELIGIBLE`）= 不可用。
// 本模块只做巡检编排，与 GUI 是否常驻无关：状态落盘，每次巡检从状态接着判断，常驻进程每分钟、无头调度进程每次被唤起各调一次 runSparkleAgyDueDuty。
// 每次巡检先看生产证据（用户真实 agy 会话的日志对当前 pin 的判决，只读文件，零探测请求）：
// 生产流量自己证明 pin 被拒就直接修复；否则只在 pin 复测到期时发探测 → 必要时修复扫描（sparkleAgyRepair）→ 收敛 provider。
// 修复扫描有三个入口：证据判决被拒、复测判定 pin 不可用、拨号失败风暴（被动触发，越过 pin 复测）。
// CLI 请求在 sparkleAgyCli，对 `🎯 agy 专用` 组的操作在 sparkleAgyGroupControl。
// 三个入口都经开关门控：`🎯 agy 专用` 关闭则整轮跳过、不发任何请求。

import { appendAppLog } from '../utils/log'
import { describeError } from '../utils/errorMessage'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { runWhenEnabled, type DedicatedGroupGate } from './dedicatedGroups'
import { subscribeMihomoAlerts } from './mihomoApi'
import { collectAgyProductionEvidence } from './sparkleAgyEvidence'
import {
  AGY_EVIDENCE_REPAIR_LIMIT,
  AGY_EVIDENCE_REPAIR_WINDOW_MS,
  canRepairOnEvidence,
  judgeAgyPinByProduction,
  recentEvidenceRepairs,
  type AgyProductionJudgement,
  type AgyProductionVerdict
} from './sparkleAgyEvidenceCore'
import { checkPin, keepPin } from './sparkleAgyPinCheck'
import {
  AGY_DUTY_TICK_MS,
  createAgyDialFailureWatch,
  isPinCheckDue,
  shouldRepairAgyPin
} from './sparkleAgyProbeCore'
import { repairPin } from './sparkleAgyRepair'
import { flagPin, openRound, type AgyRound } from './sparkleAgyRound'
import { openAgyState, type AgyState } from './sparkleAgyState'

const NO_DEADLINE = Number.POSITIVE_INFINITY

let probeInFlight = false

/** 同一时刻只允许一轮在跑（探测会占用官方账号配额与隐藏探测通道）；异常只记日志，不外抛。 */
async function runExclusiveRound(run: (state: AgyState) => Promise<void>): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    const handle = await openAgyState()
    try {
      await run(handle.state)
    } finally {
      await handle
        .commit()
        .catch((error) =>
          appendAppLog(`[SparkleAgyProbe]: state save failed, ${describeError(error)}\n`)
        )
    }
  } catch (error) {
    await appendAppLog(`[SparkleAgyProbe]: error=${describeError(error)}\n`)
  } finally {
    probeInFlight = false
  }
}

/**
 * 生产流量自己证明 pin 被拒：不等定时复测，直接修复。
 * 先占一个限速名额再动手 —— 修复中途抛错也不会逐拍重复整轮扫描；没真正扫描（没时间）就退还。
 */
async function repairOnEvidence(
  round: AgyRound,
  records: number,
  deadlineAtMs: number
): Promise<void> {
  const { state } = round
  const startedMs = Date.now()
  const before = recentEvidenceRepairs(state.evidenceRepairs, startedMs)
  state.evidenceRepairs = [...before, startedMs]
  flagPin(round, startedMs)

  const outcome = await repairPin(round, {
    reason: `trigger=production-evidence records=${records}`,
    strict: false,
    deadlineAtMs
  })
  if (outcome !== 'scanned') {
    state.evidenceRepairs = before
    return
  }
  state.lastPinCheckMs = Date.now()
  if (!canRepairOnEvidence(state.evidenceRepairs, Date.now())) {
    await appendAppLog(
      `[SparkleAgyProbe]: WARN production rejections persist after ${AGY_EVIDENCE_REPAIR_LIMIT} repairs within ${AGY_EVIDENCE_REPAIR_WINDOW_MS / 60_000}min; evidence-triggered repair paused, scheduled checks continue\n`
    )
  }
}

/** 复测 pin，判定不可用（或连续超时）才进入修复扫描。 */
async function checkAndRepair(
  round: AgyRound,
  production: AgyProductionVerdict,
  deadlineAtMs: number
): Promise<void> {
  const { state } = round
  const checkedBeforeMs = state.lastPinCheckMs
  const pin = await checkPin(round, production, deadlineAtMs)
  if (pin.kind === 'no-time') {
    return
  }
  // 复测一出结论就记下：后面的收敛 / 修复抛错也不会每一拍重测一次（每次探测都耗官方账号配额）。
  state.lastPinCheckMs = Date.now()
  if (pin.kind === 'fatal') {
    return
  }

  if (!shouldRepairAgyPin({ pinVerdict: pin.verdict, unknownStreak: state.pinUnknownStreak })) {
    await keepPin(round, pin.verdict)
    return
  }
  const outcome = await repairPin(round, {
    reason: `verdict=${pin.verdict ?? 'none'} streak=${state.pinUnknownStreak}`,
    // 只是探测超时：pin 并没被证明不可用，不能为了换而换。
    strict: pin.verdict === 'unknown',
    deadlineAtMs
  })
  if (outcome === 'no-time') {
    state.lastPinCheckMs = checkedBeforeMs
  }
}

interface DutyMode {
  /** 不看复测是否到期，立刻复测：启动与开关重新打开时用。 */
  forced: boolean
  deadlineAtMs: number
}

/**
 * 一次巡检。绝大多数拍既不必按证据修复、复测也没到期：只读日志和状态就结束，不碰订阅和内核。
 * 需要动作时才打开一轮；打开时 pin 会对齐到组里的真实选择（用户可能手动换过），所以判决要按对齐后的上任时间重判。
 */
async function runDuty(state: AgyState, mode: DutyMode): Promise<void> {
  const nowMs = Date.now()
  const evidence = await collectAgyProductionEvidence(nowMs)
  const judge = (): AgyProductionJudgement =>
    state.pin
      ? judgeAgyPinByProduction({ ...evidence, nowMs, pinSinceMs: state.pin.sinceMs })
      : { verdict: 'unobserved', records: 0 }
  // 判决被拒、限速名额没用完、也不在全灭退避里：值得立刻修复。后两者不满足时修复会原地返回，不必为此打开一轮。
  const repairableOnEvidence = (production: AgyProductionJudgement): boolean =>
    production.verdict === 'rejected' &&
    canRepairOnEvidence(state.evidenceRepairs, nowMs) &&
    nowMs >= state.repairSkipUntilMs

  const due = mode.forced || isPinCheckDue(state.lastPinCheckMs, nowMs)
  if (!due && !repairableOnEvidence(judge())) {
    return
  }
  const round = await openRound(state)
  if (!round) {
    return
  }

  const production = judge()
  if (repairableOnEvidence(production)) {
    await repairOnEvidence(round, production.records, mode.deadlineAtMs)
  } else if (due) {
    await checkAndRepair(round, production.verdict, mode.deadlineAtMs)
  }
}

/** 启动 / 开关打开时的入口：不论是否到期，pin 就地复测一次（生产证据照常先看）。 */
export async function bootstrapSparkleAgyProvider(): Promise<void> {
  await runExclusiveRound((state) => runDuty(state, { forced: true, deadlineAtMs: NO_DEADLINE }))
}

/**
 * 到期巡检的入口：常驻进程每分钟调一次，无头调度进程每次被唤起调一次。
 * 有截止时间时，来不及的步骤留给下一次（状态已落盘）。
 */
export async function runSparkleAgyDueDuty(options: { deadlineAtMs?: number } = {}): Promise<void> {
  await runExclusiveRound((state) =>
    runDuty(state, { forced: false, deadlineAtMs: options.deadlineAtMs ?? NO_DEADLINE })
  )
}

/**
 * 被动入口：生产流量在 agy 出口上大面积拨号失败。pin 的就地复测按固定间隔采样、对抖动节点还会随机通过，
 * 所以越过它直接进入修复扫描；互斥与全灭退避照常生效，不增加任何常规探测。
 */
export async function repairSparkleAgyPinOnDialFailures(): Promise<void> {
  await runExclusiveRound(async (state) => {
    const round = await openRound(state)
    if (!round) {
      return
    }
    flagPin(round, Date.now())
    const outcome = await repairPin(round, {
      reason: 'trigger=dial-failures',
      strict: false,
      deadlineAtMs: NO_DEADLINE
    })
    if (outcome === 'scanned') {
      state.lastPinCheckMs = Date.now()
    }
  })
}

let agyProbeTimer: NodeJS.Timeout | undefined

/**
 * 启动常驻巡检，并订阅内核告警以便在拨号失败风暴时不等下一拍；重复调用无副作用。
 * 巡检与告警触发的修复都先问开关：agy 组被关闭时整轮跳过，不发任何探测请求。
 */
export function startSparkleAgyProbeLoop(isEnabled: DedicatedGroupGate): void {
  if (agyProbeTimer) {
    return
  }
  agyProbeTimer = setInterval(() => {
    runWhenEnabled(isEnabled, () => runSparkleAgyDueDuty()).catch(() => undefined)
  }, AGY_DUTY_TICK_MS)
  agyProbeTimer.unref()

  const dialFailureWatch = createAgyDialFailureWatch(AGY_DEDICATED_GROUP_NAME)
  subscribeMihomoAlerts((log) => {
    if (dialFailureWatch.observe(log, Date.now())) {
      runWhenEnabled(isEnabled, repairSparkleAgyPinOnDialFailures).catch(() => undefined)
    }
  })
}
