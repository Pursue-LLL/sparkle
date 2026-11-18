// [INPUT] 当前订阅节点 · agy 组操作（sparkleAgyGroupControl）· 探测缓存（sparkleAgyProbeCache）· 展示快照（sparkleAgyProbeSnapshot） ·
//         config::getAppConfig/getProfile/getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::mihomoGroupDetail/subscribeMihomoAlerts (POS: mihomo 控制器访问层) ·
//         provider::extractProxies (POS: 订阅节点 → provider 文件) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         regionPriority::resolveEffectiveRegionPriority (POS: 地区优先级与地区匹配) ·
//         sparkleAgyCli::AGY_PROBE_MODEL (POS: 官方 agy CLI 请求) ·
//         sparkleAgyProbeCore::resolveAgyAuditBackoffMs/runAgyAudit/shouldRepairAgyPin/createAgyDialFailureWatch/AgyAuditOutcome/AgyAuditResult (POS: agy 巡检状态机) ·
//         sparkleAgyProviderCore::agyProxyName/orderAgyRepairProxies/AgyNodeProbeRecord/AgyProbeVerdict… (POS: agy provider 与分组配置) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         dedicatedGroups::runWhenEnabled (POS: 可开关专用组注册表与开关门控)
// [OUTPUT] bootstrapSparkleAgyProvider · repairSparkleAgyPinOnDialFailures · startSparkleAgyProbeLoop
// [POS] 用官方 agy CLI 的真实请求给节点定性：200 = 可用，400 `User location is not supported` = 不可用。
// 本模块只做巡检编排：pin 就地复测 → 必要时修复扫描 → 收敛 provider；
// 修复扫描有两个入口：定时复测判定 pin 不可用，或生产流量在 agy 出口上的拨号失败风暴（被动触发，越过 pin 复测）。
// CLI 请求在 sparkleAgyCli，对 `🎯 agy 专用` 组的操作在 sparkleAgyGroupControl。

import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { mihomoGroupDetail, subscribeMihomoAlerts } from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { AGY_PROBE_MODEL } from './sparkleAgyCli'
import { convergeAgyProvider, probeSingleNode, selectAgyNode } from './sparkleAgyGroupControl'
import { loadSparkleAgyProbeCache, saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import {
  createAgyDialFailureWatch,
  resolveAgyAuditBackoffMs,
  runAgyAudit,
  shouldRepairAgyPin,
  type AgyAuditOutcome,
  type AgyAuditResult
} from './sparkleAgyProbeCore'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import {
  agyProxyName,
  orderAgyRepairProxies,
  type AgyNodeProbeRecord,
  type AgyProbeVerdict,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { runWhenEnabled, type DedicatedGroupGate } from './dedicatedGroups'

/**
 * pin（当前钉住的节点）就地复测周期：只发 1 个 1-token 请求、不切组、不断流。
 * 可用缓存 TTL 是 12h（sparkleAgyProbeCache），30 分钟一轮已有 24 倍余量；
 * 5 分钟一轮纯属浪费官方账号配额（实测 6.9k input/次）。
 */
const PIN_CHECK_INTERVAL_MS = 30 * 60 * 1000
/** 单轮修复扫描最多探测多少个节点：避免一次把过多请求打给 Google 触发风控。 */
const MAX_PROBES_PER_REPAIR = 6
/** 修复扫描预算：超时节点会逐个吃掉探测超时，不能让「候选节点轮转」的窗口无限拉长。 */
const REPAIR_BUDGET_MS = 5 * 60 * 1000
/**
 * 探测超时：agy CLI 冷启动 + 模型排队可能超过 30s；pin 给足 90s，修复扫描给 60s。
 * 慢 ≠ 坏；超时只记 unknown，不把节点判死。
 */
const PIN_PROBE_TIMEOUT_MS = 90_000
const REPAIR_PROBE_TIMEOUT_MS = 60_000

function countUsable(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>,
  proxies: readonly AgyProxyRecord[]
): number {
  return proxies.filter((proxy) => cache.get(computeProxyNodeFingerprint(proxy))?.usable === true)
    .length
}

let probeInFlight = false
/** 连续全灭轮次 → 用于指数退避，避免在 Google 的冷却窗口里越试越久。 */
let consecutiveEmptyRounds = 0
/** 只拦修复扫描；pin 就地复测必须保持固定节奏，否则节点坏了也发现不了。 */
let repairSkipUntilMs = 0
let pinUnknownStreak = 0
let agyState: 'healthy' | 'repairing' | 'exhausted' = 'healthy'

/** pin 回到可用 / 修复成功：全灭退避与超时累计都属于旧 pin，作废后下一次出问题从第 1 轮重新计。 */
function resetRepairBackoff(): void {
  consecutiveEmptyRounds = 0
  repairSkipUntilMs = 0
  pinUnknownStreak = 0
}

/** 修复扫描的「本轮已试」记录：超时不会写缓存，必须单独记时间，否则下一轮会重复同一批节点。 */
const agyRepairAttempts = new Map<string, number>()

const REPAIR_ATTEMPT_RETENTION_MS = 60 * 60 * 1000

function pruneRepairAttempts(nowMs: number): void {
  for (const [fingerprint, attemptedAt] of agyRepairAttempts) {
    if (nowMs - attemptedAt > REPAIR_ATTEMPT_RETENTION_MS) {
      agyRepairAttempts.delete(fingerprint)
    }
  }
}

function recordPinOutcome(
  cache: Map<string, AgyNodeProbeRecord>,
  proxy: AgyProxyRecord,
  outcome: AgyAuditOutcome
): boolean {
  const fingerprint = computeProxyNodeFingerprint(proxy)
  const previous = cache.get(fingerprint)
  const usable = outcome.verdict === 'usable'
  cache.set(fingerprint, {
    usable,
    rttMs: outcome.rttMs,
    checkedAt: Date.now()
  })
  return !previous || previous.usable !== usable
}

/** 一轮巡检的共用上下文：订阅里的候选节点、探测缓存与当前 pin。 */
interface AgyRound {
  /** 本轮开始时的订阅：修复扫描跨了几分钟，写 provider 前要确认订阅没被切走。 */
  profileName: string
  proxies: AgyProxyRecord[]
  regionPriority: string[]
  cache: Map<string, AgyNodeProbeRecord>
  pinName: string | null
  pinProxy: AgyProxyRecord | undefined
}

/** 没有可巡检的对象（未选订阅 / 订阅无节点 / 组未生成）时返回 undefined。 */
async function openRound(): Promise<AgyRound | undefined> {
  const { current } = await getProfileConfig()
  if (!current || current === 'default') {
    return undefined
  }
  const profile = await getProfile(current)
  const proxies = extractProxies(profile) as AgyProxyRecord[]
  if (proxies.length === 0) {
    return undefined
  }

  const { proxySwitchPriority = [] } = await getAppConfig()
  const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
  const cache = await loadSparkleAgyProbeCache()
  syncAgyProbeSnapshot(cache, proxies)

  // 组未生成（无候选节点）时既没有可探测的出口，也不能热重载一个不存在的 provider。
  const group = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME).catch(() => undefined)
  if (!group) {
    return undefined
  }

  const pinName = String(group.now ?? '').trim() || null
  const pinProxy = proxies.find((proxy) => agyProxyName(proxy) === pinName)
  return { profileName: current, proxies, regionPriority, cache, pinName, pinProxy }
}

/** pin 复测结论；agy CLI 不可用时继续巡检没有意义，本轮放弃。verdict 为 null 表示没有 pin 可测。 */
type PinCheck = { aborted: true } | { aborted: false; verdict: AgyProbeVerdict | null }

/**
 * ① pin 就地复测：不切组、不关连接、不影响正在进行的会话。
 * 400 可能是账号轮转造成的：同节点再确认一次，两次都 400 才认定节点被拒；
 * 超时不复测，按轮次累计（上游整体变慢时不能反复把生产出口拖去扫一遍）。
 */
async function checkPin(round: AgyRound): Promise<PinCheck> {
  const { cache, proxies, pinName, pinProxy } = round
  if (!pinName || !pinProxy) {
    pinUnknownStreak = 0
    return { aborted: false, verdict: null }
  }

  let outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
  if (outcome.fatal) {
    return { aborted: true }
  }
  if (outcome.verdict === 'unusable') {
    outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
    if (outcome.fatal) {
      return { aborted: true }
    }
  }
  if (outcome.verdict !== 'unknown') {
    const changed = recordPinOutcome(cache, pinProxy, outcome)
    if (changed) {
      await saveSparkleAgyProbeCache(cache)
    }
  }
  syncAgyProbeSnapshot(cache, proxies)
  pinUnknownStreak = outcome.verdict === 'unknown' ? pinUnknownStreak + 1 : 0
  return { aborted: false, verdict: outcome.verdict }
}

/**
 * pin 没被判不可用：按缓存收敛 provider；只有实测可用才算恢复。
 * 仅超时一轮就清掉退避的话，紧随其后的 400 会绕过退避立刻再扫一遍。
 */
async function keepPin(round: AgyRound, pinVerdict: AgyProbeVerdict | null): Promise<void> {
  const ordered = await convergeAgyProvider(round.proxies, round.regionPriority, round.cache)
  await selectAgyNode(ordered, round.pinName)
  if (pinVerdict !== 'usable') {
    return
  }
  resetRepairBackoff()
  if (agyState !== 'healthy') {
    await appendAppLog(
      `[SparkleAgyProbe]: pin ${round.pinName ?? 'n/a'} healthy again, pool=${ordered.length}\n`
    )
    agyState = 'healthy'
  }
}

/** 先扩 provider 让所有候选都能被切到（此时不改选择，线上出口不变），再按地区优先逐个实测；没有候选池时返回 undefined。 */
async function scanForUsableNode(round: AgyRound): Promise<AgyAuditResult | undefined> {
  const { proxies, regionPriority, cache, pinName } = round
  const expanded = await convergeAgyProvider(proxies, regionPriority, undefined)
  if (expanded.length === 0) {
    return undefined
  }
  pruneRepairAttempts(Date.now())
  // pin 不当候选：必须在截断前排除，否则缓存里没有「已拒绝」记录的 pin 会白占一个名额。
  const candidates = orderAgyRepairProxies(
    proxies.filter((proxy) => agyProxyName(proxy) !== pinName),
    regionPriority,
    cache,
    MAX_PROBES_PER_REPAIR,
    Date.now(),
    agyRepairAttempts
  )
  const audit = await runAgyAudit(
    {
      pending: candidates,
      cache,
      budgetMs: REPAIR_BUDGET_MS,
      stopOnUsable: true,
      attempted: agyRepairAttempts
    },
    { probeNode: (nodeName) => probeSingleNode(nodeName, REPAIR_PROBE_TIMEOUT_MS) }
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
  const { proxies, regionPriority, cache, pinName } = round
  const ordered = await convergeAgyProvider(proxies, regionPriority, cache)
  if (audit.usableNode) {
    await selectAgyNode(ordered, audit.usableNode)
    resetRepairBackoff()
    agyState = 'healthy'
    await appendAppLog(
      `[SparkleAgyProbe]: repaired pin ${pinName ?? 'n/a'} -> ${audit.usableNode} probed=${audit.probed} usable=${audit.usable} pool=${ordered.length}\n`
    )
    return
  }

  const kept = await selectAgyNode(ordered, pinName)
  consecutiveEmptyRounds += 1
  repairSkipUntilMs =
    Date.now() + resolveAgyAuditBackoffMs(PIN_CHECK_INTERVAL_MS, consecutiveEmptyRounds)
  agyState = 'exhausted'
  await appendAppLog(
    `[SparkleAgyProbe]: WARN no node passed the real agy check (probed=${audit.probed}); keep ${kept ?? 'none'} empty_rounds=${consecutiveEmptyRounds}\n`
  )
}

/**
 * ② 修复扫描：两个入口共用的唯一修复路径，受全灭退避约束。
 * `reason` 写进「repair start」日志，说明是谁判定需要修复。
 */
async function repairPin(round: AgyRound, reason: string): Promise<void> {
  if (Date.now() < repairSkipUntilMs) {
    return
  }

  if (agyState !== 'repairing') {
    await appendAppLog(
      `[SparkleAgyProbe]: pin ${round.pinName ?? 'n/a'} ${reason} verified=${countUsable(round.cache, round.proxies)} model=${AGY_PROBE_MODEL}, repair start\n`
    )
    agyState = 'repairing'
  }

  const audit = await scanForUsableNode(round)
  if (!audit) {
    return
  }
  // 巡检跨了几分钟，期间可能已经切订阅：用旧 profile 的节点写 provider 会污染新配置。
  const latest = await getProfileConfig()
  if (latest.current !== round.profileName) {
    return
  }
  await settleRepair(round, audit)
}

/** 同一时刻只允许一轮在跑（探测会切组、占用官方账号配额）；异常只记日志，不外抛。 */
async function runExclusiveRound(run: () => Promise<void>): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    await run()
  } catch (error) {
    await appendAppLog(
      `[SparkleAgyProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    probeInFlight = false
  }
}

/** 定时入口：pin 就地复测，判定不可用才进入修复扫描。 */
export async function bootstrapSparkleAgyProvider(): Promise<void> {
  await runExclusiveRound(async () => {
    const round = await openRound()
    if (!round) {
      return
    }
    const pin = await checkPin(round)
    if (pin.aborted) {
      return
    }
    if (!shouldRepairAgyPin({ pinVerdict: pin.verdict, unknownStreak: pinUnknownStreak })) {
      await keepPin(round, pin.verdict)
      return
    }
    await repairPin(round, `verdict=${pin.verdict ?? 'none'} streak=${pinUnknownStreak}`)
  })
}

/**
 * 被动入口：生产流量在 agy 出口上大面积拨号失败。pin 的就地复测按固定间隔采样、对抖动节点还会随机通过，
 * 所以越过它直接进入修复扫描；互斥与全灭退避照常生效，不增加任何常规探测。
 */
export async function repairSparkleAgyPinOnDialFailures(): Promise<void> {
  await runExclusiveRound(async () => {
    const round = await openRound()
    if (round) {
      await repairPin(round, 'trigger=dial-failures')
    }
  })
}

let agyProbeTimer: NodeJS.Timeout | undefined

/**
 * 启动定时巡检，并订阅内核告警以便在拨号失败风暴时不等下一轮；重复调用无副作用。
 * 定时巡检与告警触发的修复都先问开关：agy 组被关闭时整轮跳过，不发任何探测请求。
 */
export function startSparkleAgyProbeLoop(isEnabled: DedicatedGroupGate): void {
  if (agyProbeTimer) {
    return
  }
  agyProbeTimer = setInterval(() => {
    runWhenEnabled(isEnabled, bootstrapSparkleAgyProvider).catch(() => undefined)
  }, PIN_CHECK_INTERVAL_MS)
  agyProbeTimer.unref()

  const dialFailureWatch = createAgyDialFailureWatch(AGY_DEDICATED_GROUP_NAME)
  subscribeMihomoAlerts((log) => {
    if (dialFailureWatch.observe(log, Date.now())) {
      runWhenEnabled(isEnabled, repairSparkleAgyPinOnDialFailures).catch(() => undefined)
    }
  })
}
