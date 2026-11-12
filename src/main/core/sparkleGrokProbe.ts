// [INPUT] 通过 mixed-port（不可用时走 TUN 直连）真实请求 grok.com 的结果（sparkleGrokRoutedCheck）· grok 组操作（sparkleGrokGroupControl）· provider 文件（sparkleGrokProviderSync）· 探测缓存（sparkleGrokProbeCache）
// [OUTPUT] bootstrapSparkleGrokProvider · startSparkleGrokProbeLoop
// [POS] `grok 专用` 的选路探针：节点是否可用只由「真实请求 grok.com 得到 200 且无 cf-mitigated challenge」判定；
//       候选池只收录 routed 验证通过的节点。稳态每 60 秒只复核当前节点，失败才按池内顺序找下一个（找到即停）；
//       每 5 分钟用非侵入式 group-delay(expected=200) 全量刷新池内延迟，不切组、不断连。

import { getProfile, getProfileConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { currentGrokNode, refreshGrokPoolIfDue, switchGrokNode } from './sparkleGrokGroupControl'
import {
  loadSparkleGrokProbeCache,
  recordRouted,
  recordRoutedFailure,
  saveSparkleGrokProbeCache
} from './sparkleGrokProbeCache'
import { syncGrokProbeSnapshot } from './sparkleGrokProbeSnapshot'
import {
  orderGrokCandidates,
  orderGrokProxies,
  orderGrokRepairCandidates,
  grokProxyName,
  buildSparkleGrokProviderDocument,
  type GrokNodeProbeRecord,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'
import {
  ensureGrokProviderReloaded,
  reloadGrokProvider,
  writeGrokProviderFromCache,
  writeProviderDocument
} from './sparkleGrokProviderSync'
import { requestGrokViaRoute, resolveMixedPort } from './sparkleGrokRoutedCheck'

const RECHECK_INTERVAL_MS = 60 * 1000
/** 单轮探测总预算：超时就保存已测结果，避免一次卡死把后续循环全部挡掉。 */
const PROBE_PASS_MAX_MS = 10 * 60 * 1000
/** 发现阶段拿到 3 个可用节点就停，够兜底即可。 */
const DISCOVERY_TARGET_ALIVE = 3
/** 单轮修复/发现最多试几个候选：HEAD 再便宜也不为突发故障全量体检 129 个节点。 */
const MAX_PROBES_PER_REPAIR = 6
/** 15 分钟内试过的候选降级到队尾，防止超时节点反复占用扫描预算（与 agy 一致）。 */
const REPAIR_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
/** 尝试记录保留 1 小时，足够覆盖多轮修复扫描。 */
const REPAIR_ATTEMPT_RETENTION_MS = 60 * 60 * 1000

let probeRunning = false
let probeStartedAt = 0

/** 修复/发现阶段试过的节点：fingerprint → attemptedAt（15 分钟内降级到队尾）。 */
const grokRepairAttempts = new Map<string, number>()
/** 连续全灭轮次 → 指数退避，避免在节点全挂时每分钟扫一遍全量候选。 */
let consecutiveEmptyRounds = 0
/** 只拦修复/发现；当前节点 pin 仍保持 60 秒复核节奏（与 agy 一致）。 */
let repairSkipUntilMs = 0

async function loadCurrentGrokProxies(): Promise<GrokProxyRecord[]> {
  const { current } = await getProfileConfig()
  if (!current || current === 'default') {
    return []
  }
  const currentProfile = await getProfile(current)
  return extractProxies(currentProfile) as GrokProxyRecord[]
}

function pruneRepairAttempts(nowMs: number): void {
  for (const [fingerprint, attemptedAt] of grokRepairAttempts) {
    if (nowMs - attemptedAt > REPAIR_ATTEMPT_RETENTION_MS) {
      grokRepairAttempts.delete(fingerprint)
    }
  }
}

function markRepairAttempt(proxy: GrokProxyRecord): void {
  grokRepairAttempts.set(computeProxyNodeFingerprint(proxy), Date.now())
}

function resolveRepairBackoffMs(emptyRounds: number): number {
  return RECHECK_INTERVAL_MS * Math.min(emptyRounds, 3)
}

/** 切换并做真实请求验证；只有 routed 通过才写入 alive。 */
async function tryNode(
  proxy: GrokProxyRecord,
  mixedPort: number,
  cache: Map<string, GrokNodeProbeRecord>
): Promise<boolean> {
  const name = grokProxyName(proxy)
  markRepairAttempt(proxy)
  if (!(await switchGrokNode(name))) {
    return false
  }
  const check = await requestGrokViaRoute(mixedPort)
  if (check.ok) {
    recordRouted(cache, proxy, check)
    return true
  }
  recordRoutedFailure(cache, proxy, check)
  await appendAppLog(
    `[SparkleGrokProbe]: node=${name} routed failed ${check.reason} (${check.rttMs}ms)\n`
  )
  return false
}

/** 发现阶段：先把 provider 扩到全量，逐个真实请求验证，拿到目标数量立即停。 */
async function discoverWorking(
  proxies: readonly GrokProxyRecord[],
  cache: Map<string, GrokNodeProbeRecord>,
  mixedPort: number,
  deadline: number
): Promise<string | null> {
  await writeProviderDocument(proxies)
  await reloadGrokProvider()

  const working: GrokProxyRecord[] = []
  let probed = 0
  const now = Date.now()
  pruneRepairAttempts(now)
  const candidates = orderGrokRepairCandidates(
    orderGrokCandidates(proxies),
    grokRepairAttempts,
    now,
    REPAIR_ATTEMPT_WINDOW_MS
  )
  for (const proxy of candidates) {
    if (
      working.length >= DISCOVERY_TARGET_ALIVE ||
      probed >= MAX_PROBES_PER_REPAIR ||
      Date.now() >= deadline
    ) {
      break
    }
    probed += 1
    if (await tryNode(proxy, mixedPort, cache)) {
      working.push(proxy)
    }
  }

  if (working.length === 0) {
    await appendAppLog(`[SparkleGrokProbe]: discovery probed=${probed} working=0\n`)
    return null
  }

  // 池子只保留 routed 验证通过的节点（顺序按真实 RTT）。
  const selected = buildSparkleGrokProviderDocument({ proxies: working, probeCache: cache })
  await writeProviderDocument(selected.proxies)
  await reloadGrokProvider()
  const first = grokProxyName(selected.proxies[0])
  await appendAppLog(
    `[SparkleGrokProbe]: discovery probed=${probed} working=${working.length} pool=${selected.proxies.length}\n`
  )
  return (await switchGrokNode(first)) ? first : null
}

interface GrokSelectionResult {
  selected: string | null
  /** 本轮是否真的跑了修复/发现扫描；退避跳过的轮次不参与空轮计数。 */
  scanned: boolean
}

/** 稳态：真实请求复核当前节点；失败才按池内顺序找下一个；池内全灭才重新发现。 */
async function ensureGrokSelection(
  proxies: readonly GrokProxyRecord[],
  cache: Map<string, GrokNodeProbeRecord>,
  mixedPort: number,
  deadline: number
): Promise<GrokSelectionResult> {
  const current = await currentGrokNode()
  const currentProxy = current
    ? proxies.find((proxy) => grokProxyName(proxy) === current)
    : undefined
  if (currentProxy) {
    let check = await requestGrokViaRoute(mixedPort)
    // 网络超时是瞬时的：同一节点再给一次机会，避免因为一次抖动就断连接、换节点。
    if (!check.ok && check.status === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1000)
      })
      check = await requestGrokViaRoute(mixedPort)
    }
    if (check.ok) {
      recordRouted(cache, currentProxy, check)
      return { selected: current, scanned: false }
    }
    recordRoutedFailure(cache, currentProxy, check)
    await appendAppLog(
      `[SparkleGrokProbe]: current=${current} routed failed ${check.reason} (${check.rttMs}ms)\n`
    )
  }

  // 全灭退避期间只做当前节点 pin，不触发修复/发现扫描（与 agy 一致）。
  if (Date.now() < repairSkipUntilMs) {
    return { selected: null, scanned: false }
  }

  const now = Date.now()
  pruneRepairAttempts(now)
  const pool = orderGrokRepairCandidates(
    orderGrokProxies(proxies, cache),
    grokRepairAttempts,
    now,
    REPAIR_ATTEMPT_WINDOW_MS
  )
  let probed = 0
  for (const proxy of pool) {
    const name = grokProxyName(proxy)
    if (name === current) {
      continue
    }
    if (probed >= MAX_PROBES_PER_REPAIR || Date.now() >= deadline) {
      break
    }
    probed += 1
    if (await tryNode(proxy, mixedPort, cache)) {
      return { selected: name, scanned: true }
    }
  }

  return { selected: await discoverWorking(proxies, cache, mixedPort, deadline), scanned: true }
}

export async function bootstrapSparkleGrokProvider(): Promise<void> {
  if (probeRunning) {
    if (Date.now() - probeStartedAt < PROBE_PASS_MAX_MS) {
      return
    }
    // 上一轮卡死（例如 mihomo API 无响应）时强制复位，避免整个循环永久停摆。
    await appendAppLog('[SparkleGrokProbe]: stale pass exceeded budget, resetting\n')
  }
  probeRunning = true
  probeStartedAt = Date.now()
  const deadline = probeStartedAt + PROBE_PASS_MAX_MS
  try {
    const proxies = await loadCurrentGrokProxies()
    if (proxies.length === 0) {
      return
    }

    const cache = await loadSparkleGrokProbeCache()
    const mixedPort = await resolveMixedPort()
    syncGrokProbeSnapshot(proxies, cache)

    // 每 5 分钟全量刷新池内延迟：不切组/不断连，只更新展示与缓存。
    await refreshGrokPoolIfDue(proxies, cache)

    if (cache.size === 0) {
      const selected = await discoverWorking(proxies, cache, mixedPort, deadline)
      await saveSparkleGrokProbeCache(cache)
      syncGrokProbeSnapshot(proxies, cache)
      if (selected) {
        consecutiveEmptyRounds = 0
        repairSkipUntilMs = 0
      } else {
        consecutiveEmptyRounds += 1
        repairSkipUntilMs = Date.now() + resolveRepairBackoffMs(consecutiveEmptyRounds)
        await appendAppLog(
          `[SparkleGrokProbe]: WARN discovery found nothing (empty_rounds=${consecutiveEmptyRounds})\n`
        )
      }
      await appendAppLog(`[SparkleGrokProbe]: initial selection=${selected ?? 'none'}\n`)
      return
    }

    await writeGrokProviderFromCache(proxies, cache)
    await ensureGrokProviderReloaded()

    const { selected, scanned } = await ensureGrokSelection(proxies, cache, mixedPort, deadline)
    await saveSparkleGrokProbeCache(cache)
    syncGrokProbeSnapshot(proxies, cache)
    if (selected) {
      consecutiveEmptyRounds = 0
      repairSkipUntilMs = 0
      await appendAppLog(`[SparkleGrokProbe]: selected=${selected}\n`)
    } else if (scanned) {
      consecutiveEmptyRounds += 1
      repairSkipUntilMs = Date.now() + resolveRepairBackoffMs(consecutiveEmptyRounds)
      await appendAppLog(
        `[SparkleGrokProbe]: WARN no usable node (empty_rounds=${consecutiveEmptyRounds} next_repair_in=${Math.round(resolveRepairBackoffMs(consecutiveEmptyRounds) / 1000)}s)\n`
      )
    } else {
      await appendAppLog(
        `[SparkleGrokProbe]: pin failed, repair backoff ${Math.max(0, Math.round((repairSkipUntilMs - Date.now()) / 1000))}s remaining (empty_rounds=${consecutiveEmptyRounds})\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGrokProbe]: error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    probeRunning = false
  }
}

let grokProbeTimer: NodeJS.Timeout | undefined

export function startSparkleGrokProbeLoop(): void {
  if (grokProbeTimer) {
    return
  }
  grokProbeTimer = setInterval(() => {
    bootstrapSparkleGrokProvider().catch(() => undefined)
  }, RECHECK_INTERVAL_MS)
  grokProbeTimer.unref()
}
