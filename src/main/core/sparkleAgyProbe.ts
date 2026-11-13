// [INPUT] 当前订阅节点 · agy 组操作（sparkleAgyGroupControl）· 探测缓存（sparkleAgyProbeCache）· 展示快照（sparkleAgyProbeSnapshot） ·
//         config::getAppConfig/getProfile/getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorProxyGroup::AGY_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::mihomoGroupDetail (POS: mihomo 控制器访问层) ·
//         provider::extractProxies (POS: 订阅节点 → provider 文件) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         regionPriority::resolveEffectiveRegionPriority (POS: 地区优先级与地区匹配) ·
//         sparkleAgyCli::AGY_PROBE_MODEL (POS: 官方 agy CLI 请求) ·
//         sparkleAgyProbeCore::resolveAgyAuditBackoffMs/runAgyAudit/shouldRepairAgyPin/AgyAuditOutcome (POS: agy 巡检状态机) ·
//         sparkleAgyProviderCore::agyProxyName/orderAgyRepairProxies/AgyNodeProbeRecord/AgyProbeVerdict… (POS: agy provider 与分组配置) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] bootstrapSparkleAgyProvider · startSparkleAgyProbeLoop
// [POS] 用官方 agy CLI 的真实请求给节点定性：200 = 可用，400 `User location is not supported` = 不可用。
// 本模块只做巡检编排：pin 就地复测 → 必要时修复扫描 → 收敛 provider；
// CLI 请求在 sparkleAgyCli，对 `🎯 agy 专用` 组的操作在 sparkleAgyGroupControl。

import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { mihomoGroupDetail } from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { AGY_PROBE_MODEL } from './sparkleAgyCli'
import { convergeAgyProvider, probeSingleNode, selectAgyNode } from './sparkleAgyGroupControl'
import { loadSparkleAgyProbeCache, saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import {
  resolveAgyAuditBackoffMs,
  runAgyAudit,
  shouldRepairAgyPin,
  type AgyAuditOutcome
} from './sparkleAgyProbeCore'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import {
  agyProxyName,
  orderAgyRepairProxies,
  type AgyNodeProbeRecord,
  type AgyProbeVerdict,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'

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

/** pin 回到可用 / 修复成功：全灭退避作废，下一次出问题从第 1 轮重新计。 */
function resetRepairBackoff(): void {
  consecutiveEmptyRounds = 0
  repairSkipUntilMs = 0
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

export async function bootstrapSparkleAgyProvider(): Promise<void> {
  if (probeInFlight) {
    return
  }
  probeInFlight = true
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return
    }
    const profile = await getProfile(current)
    const proxies = extractProxies(profile) as AgyProxyRecord[]
    if (proxies.length === 0) {
      return
    }

    const { proxySwitchPriority = [] } = await getAppConfig()
    const regionPriority = resolveEffectiveRegionPriority(proxySwitchPriority)
    const cache = await loadSparkleAgyProbeCache()
    syncAgyProbeSnapshot(cache, proxies)

    // 组未生成（无候选节点）时既没有可探测的出口，也不能热重载一个不存在的 provider。
    const group = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME).catch(() => undefined)
    if (!group) {
      return
    }

    const pinName = String(group.now ?? '').trim() || null
    const pinProxy = proxies.find((proxy) => agyProxyName(proxy) === pinName)

    // ① pin 就地复测：不切组、不关连接、不影响正在进行的会话。
    // 400 可能是账号轮转造成的：同节点再确认一次，两次都 400 才认定节点被拒；
    // 超时不复测，按轮次累计（上游整体变慢时不能把生产出口每 3 分钟拖去扫一遍）。
    let pinVerdict: AgyProbeVerdict | null = null
    if (pinName && pinProxy) {
      let outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
      if (outcome.fatal) {
        return
      }
      if (outcome.verdict === 'unusable') {
        outcome = await probeSingleNode(pinName, PIN_PROBE_TIMEOUT_MS)
        if (outcome.fatal) {
          return
        }
      }
      if (outcome.verdict !== 'unknown') {
        const changed = recordPinOutcome(cache, pinProxy, outcome)
        if (changed) {
          await saveSparkleAgyProbeCache(cache)
        }
      }
      syncAgyProbeSnapshot(cache, proxies)
      pinVerdict = outcome.verdict
      pinUnknownStreak = outcome.verdict === 'unknown' ? pinUnknownStreak + 1 : 0
    } else {
      pinUnknownStreak = 0
    }

    const verifiedCount = countUsable(cache, proxies)
    const needsRepair = shouldRepairAgyPin({ pinVerdict, unknownStreak: pinUnknownStreak })

    if (!needsRepair) {
      // pin 没被判不可用就按缓存收敛 provider；只有实测可用才算恢复。
      // 仅超时一轮就清掉退避的话，紧随其后的 400 会绕过退避立刻再扫一遍。
      const ordered = await convergeAgyProvider(proxies, regionPriority, cache)
      await selectAgyNode(ordered, pinName)
      if (pinVerdict === 'usable') {
        resetRepairBackoff()
        if (agyState !== 'healthy') {
          await appendAppLog(
            `[SparkleAgyProbe]: pin ${pinName ?? 'n/a'} healthy again, pool=${ordered.length}\n`
          )
          agyState = 'healthy'
        }
      }
      return
    }

    if (Date.now() < repairSkipUntilMs) {
      return
    }

    if (agyState !== 'repairing') {
      await appendAppLog(
        `[SparkleAgyProbe]: pin ${pinName ?? 'n/a'} verdict=${pinVerdict ?? 'none'} streak=${pinUnknownStreak} verified=${verifiedCount} model=${AGY_PROBE_MODEL}, repair start\n`
      )
      agyState = 'repairing'
    }

    // ② 修复扫描：先扩 provider 让所有候选都能被切到（此时不改选择，线上出口不变）。
    const expanded = await convergeAgyProvider(proxies, regionPriority, undefined)
    if (expanded.length === 0) {
      return
    }
    pruneRepairAttempts(Date.now())
    const candidates = orderAgyRepairProxies(
      proxies,
      regionPriority,
      cache,
      MAX_PROBES_PER_REPAIR,
      Date.now(),
      agyRepairAttempts
    ).filter((proxy) => agyProxyName(proxy) !== pinName)
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

    // 巡检跨了几分钟，期间可能已经切订阅：用旧 profile 的节点写 provider 会污染新配置。
    const latest = await getProfileConfig()
    if (latest.current !== current) {
      return
    }

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

    // 全灭：没有证据表明别的节点更好，pin 还在候选池里就留在 pin 上，并拉长下一轮修复间隔。
    const kept = await selectAgyNode(ordered, pinName)
    consecutiveEmptyRounds += 1
    repairSkipUntilMs =
      Date.now() + resolveAgyAuditBackoffMs(PIN_CHECK_INTERVAL_MS, consecutiveEmptyRounds)
    agyState = 'exhausted'
    await appendAppLog(
      `[SparkleAgyProbe]: WARN no node passed the real agy check (probed=${audit.probed}); keep ${kept ?? 'none'} empty_rounds=${consecutiveEmptyRounds}\n`
    )
  } catch (error) {
    await appendAppLog(
      `[SparkleAgyProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    probeInFlight = false
  }
}

let agyProbeTimer: NodeJS.Timeout | undefined

export function startSparkleAgyProbeLoop(): void {
  if (agyProbeTimer) {
    return
  }
  agyProbeTimer = setInterval(() => {
    bootstrapSparkleAgyProvider().catch(() => undefined)
  }, PIN_CHECK_INTERVAL_MS)
  agyProbeTimer.unref()
}
