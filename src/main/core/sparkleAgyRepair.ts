// [INPUT] 一轮巡检上下文 · agy 组操作 · 探测缓存 ·
//         config::getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         sparkleAgyCli::AGY_PROBE_MODEL (POS: 官方 agy CLI 请求) ·
//         sparkleAgyGroupControl::convergeAgyProvider/probeSingleNode (POS: agy 组操作) ·
//         sparkleAgyProbeCache::saveSparkleAgyProbeCache (POS: agy 探测缓存读写) ·
//         sparkleAgyProbeCore::AGY_PIN_CHECK_INTERVAL_MS/resolveAgyAuditBackoffMs/resolveProbeTimeoutMs/runAgyAudit/AgyAuditResult (POS: agy 巡检状态机) ·
//         sparkleAgyProbeSnapshot::syncAgyProbeSnapshot (POS: agy 展示快照) ·
//         sparkleAgyProviderCore::agyProxyName/collectEligibleAgyProxies/orderAgyRepairProxies (POS: agy provider 与分组配置) ·
//         sparkleAgyReputation::partitionByReputation (POS: agy 节点被拒记忆) ·
//         sparkleAgyRound::AgyRound/countUsable/selectPin (POS: agy 一轮巡检上下文) ·
//         sparkleAgyState::clearAgyRepairBackoff (POS: agy 巡检状态持久化) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] repairPin · AgyRepairPlan · AgyRepairOutcome
// [POS] 修复扫描：pin 不可用时按地区优先逐个实测候选节点，找到可用的就切过去，全灭则留在 pin 上并拉长下一轮间隔。
// 各入口（定时复测、拨号失败风暴）共用这唯一一条修复路径，受全灭退避约束。
// 只切到「刚刚实测可用」的节点：候选先试没被判定出过问题的（排序见 sparkleAgyProviderCore），
// pin 只是探测超时、并没被证明不可用时更严格——最近出过问题的节点连候选都不是，宁可留在 pin 上。
// 有截止时间的调用方（无头调度进程必须在下一次被唤起之前收尾）：不够发一次探测的时间就不开扫描，
// 扫描中每次探测的超时都收紧到截止之前，来不及的候选留给下一次。

import { getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { AGY_PROBE_MODEL } from './sparkleAgyCli'
import { convergeAgyProvider, probeSingleNode } from './sparkleAgyGroupControl'
import { saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import {
  AGY_PIN_CHECK_INTERVAL_MS,
  resolveAgyAuditBackoffMs,
  resolveProbeTimeoutMs,
  runAgyAudit,
  type AgyAuditResult
} from './sparkleAgyProbeCore'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import {
  agyProxyName,
  collectEligibleAgyProxies,
  orderAgyRepairProxies
} from './sparkleAgyProviderCore'
import { partitionByReputation } from './sparkleAgyReputation'
import { countUsable, selectPin, type AgyRound } from './sparkleAgyRound'
import { clearAgyRepairBackoff } from './sparkleAgyState'

/** 单轮修复扫描最多探测多少个节点：避免一次把过多请求打给 Google 触发风控。 */
const MAX_PROBES_PER_REPAIR = 6
/** 修复扫描预算：超时节点会逐个吃掉探测超时，不能让「候选节点轮转」的窗口无限拉长。 */
const REPAIR_BUDGET_MS = 5 * 60 * 1000
/** 修复扫描的探测超时；慢 ≠ 坏，超时只记 unknown，不把节点判死。 */
const REPAIR_PROBE_TIMEOUT_MS = 60_000

export interface AgyRepairPlan {
  /** 写进「repair start」日志，说明是谁判定需要修复。 */
  reason: string
  /** pin 并没被证明出口不可用（只是探测超时）：最近出过问题的节点不当候选。 */
  strict: boolean
  /** 绝对截止时间（ms）；没有截止时间的常驻进程传 Infinity。 */
  deadlineAtMs: number
}

/**
 * - `scanned`：做了一次扫描（订阅中途被切走而作废的也算）；
 * - `backed-off`：还在全灭退避里，没动；
 * - `no-time`：离截止时间太近，一次探测都发不出去，没动。
 */
export type AgyRepairOutcome = 'scanned' | 'backed-off' | 'no-time'

/** 按地区优先逐个实测：探测走隐藏通道，任何订阅节点都能测、线上出口全程不变；没有候选池时返回 undefined。 */
async function scanForUsableNode(
  round: AgyRound,
  plan: AgyRepairPlan
): Promise<AgyAuditResult | undefined> {
  const { proxies, regionPriority, cache, pinName, state } = round
  if (collectEligibleAgyProxies(proxies).length === 0) {
    return undefined
  }

  // pin 不当候选：必须在截断前排除，否则缓存里没有「已拒绝」记录的 pin 会白占一个名额。
  const others = proxies.filter((proxy) => agyProxyName(proxy) !== pinName)
  const nowMs = Date.now()
  const candidates = orderAgyRepairProxies(
    plan.strict ? partitionByReputation(others, cache, state.flags, nowMs).clean : others,
    regionPriority,
    cache,
    MAX_PROBES_PER_REPAIR,
    nowMs,
    state.attempts,
    state.flags
  )
  const audit = await runAgyAudit(
    {
      pending: candidates,
      cache,
      budgetMs: REPAIR_BUDGET_MS,
      probeTimeoutMs: REPAIR_PROBE_TIMEOUT_MS,
      deadlineAtMs: plan.deadlineAtMs,
      stopOnUsable: true,
      attempted: state.attempts,
      flags: state.flags
    },
    { probeNode: probeSingleNode }
  )

  if (audit.probed > 0) {
    await saveSparkleAgyProbeCache(cache)
  }
  // 失败（unknown）不写缓存，但必须反映到 UI，避免整页"未测"造成误解。
  syncAgyProbeSnapshot(cache, proxies)
  return audit
}

/** 扫描结果落地：找到可用节点就切过去；全灭则没有证据表明别的节点更好，pin 还在候选池里就留在 pin 上，并拉长下一轮修复间隔。 */
async function settleRepair(round: AgyRound, audit: AgyAuditResult): Promise<void> {
  const { proxies, regionPriority, cache, pinName, state } = round
  const ordered = await convergeAgyProvider(proxies, regionPriority, cache, state.flags)
  if (audit.usableNode) {
    await selectPin(round, ordered, audit.usableNode)
    clearAgyRepairBackoff(state)
    state.phase = 'healthy'
    await appendAppLog(
      `[SparkleAgyProbe]: repaired pin ${pinName ?? 'n/a'} -> ${audit.usableNode} probed=${audit.probed} usable=${audit.usable} pool=${ordered.length}\n`
    )
    return
  }

  const kept = await selectPin(round, ordered, pinName)
  if (audit.outOfTime) {
    // 候选没扫完就被截止时间截断：这不是「池子里没有可用节点」，不能为此拉长退避；已试的节点下次排到后面，接着扫。
    await appendAppLog(
      `[SparkleAgyProbe]: scan cut short by the deadline (probed=${audit.probed}); keep ${kept ?? 'none'}, resume next time\n`
    )
    return
  }
  state.emptyRounds += 1
  state.repairSkipUntilMs =
    Date.now() + resolveAgyAuditBackoffMs(AGY_PIN_CHECK_INTERVAL_MS, state.emptyRounds)
  state.phase = 'exhausted'
  await appendAppLog(
    `[SparkleAgyProbe]: WARN no node passed the real agy check (probed=${audit.probed}); keep ${kept ?? 'none'} empty_rounds=${state.emptyRounds}\n`
  )
}

/** 修复扫描：受全灭退避与截止时间约束。 */
export async function repairPin(round: AgyRound, plan: AgyRepairPlan): Promise<AgyRepairOutcome> {
  const { state } = round
  if (Date.now() < state.repairSkipUntilMs) {
    return 'backed-off'
  }
  if (resolveProbeTimeoutMs(REPAIR_PROBE_TIMEOUT_MS, plan.deadlineAtMs, Date.now()) === undefined) {
    return 'no-time'
  }

  if (state.phase !== 'repairing') {
    await appendAppLog(
      `[SparkleAgyProbe]: pin ${round.pinName ?? 'n/a'} ${plan.reason} verified=${countUsable(round)} model=${AGY_PROBE_MODEL}, repair start\n`
    )
    state.phase = 'repairing'
  }

  const audit = await scanForUsableNode(round, plan)
  if (audit) {
    // 巡检跨了几分钟，期间可能已经切订阅：用旧 profile 的节点写 provider 会污染新配置。
    const latest = await getProfileConfig()
    if (latest.current === round.profileName) {
      await settleRepair(round, audit)
    }
  }
  return 'scanned'
}
