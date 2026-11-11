// [INPUT] 通过 mixed-port（不可用时走 TUN 直连）真实请求 grok.com 的结果 · mihomoGroupDetail / mihomoChangeProxy / mihomoGroupDelay
// [OUTPUT] loadSparkleGrokProbeCache · bootstrapSparkleGrokProvider · startSparkleGrokProbeLoop · getSparkleGrokProbeSnapshot
// [POS] `grok 专用` 的选路探针：节点是否可用只由「真实请求 grok.com 得到 200 且无 cf-mitigated challenge」判定；
//       候选池只收录 routed 验证通过的节点。稳态每 60 秒只复核当前节点，失败才按池内顺序找下一个（找到即停）；
//       每 5 分钟用非侵入式 group-delay(expected=200) 全量刷新池内延迟，不切组、不断连。

import axios from 'axios'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getControledMihomoConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { GROK_DEDICATED_GROUP_NAME, GROK_DELAY_TEST_URL } from './cursorProxyGroup'
import {
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDelay,
  mihomoGroupDetail,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  buildGrokProbeSnapshot,
  buildSparkleGrokProviderDocument,
  grokProviderMembershipChanged,
  GROK_NODE_PROVIDER_FILENAME,
  GROK_NODE_PROVIDER_ID,
  isGrokRoutedResponseUsable,
  orderGrokCandidates,
  orderGrokProxies,
  orderGrokRepairCandidates,
  type GrokNodeProbeCache,
  type GrokNodeProbeRecord,
  type GrokProbeSample,
  type GrokProbeSnapshot,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'

const CACHE_FILENAME = 'sparkle-grok-nodes.json'
const RECHECK_INTERVAL_MS = 60 * 1000
const ROUTED_CHECK_TIMEOUT_MS = 8000
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
/** 池内全部成员的延迟刷新周期：非侵入式 group-delay，不切组、不断连。 */
const POOL_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let providerReloadPending = false
let providerReloadFailing = false
let probeRunning = false
let probeStartedAt = 0

/** 修复/发现阶段试过的节点：fingerprint → attemptedAt（15 分钟内降级到队尾）。 */
const grokRepairAttempts = new Map<string, number>()
/** 连续全灭轮次 → 指数退避，避免在节点全挂时每分钟扫一遍全量候选。 */
let consecutiveEmptyRounds = 0
/** 只拦修复/发现；当前节点 pin 仍保持 60 秒复核节奏（与 agy 一致）。 */
let repairSkipUntilMs = 0
/** 上次池内全量延迟刷新时间；避免每分钟重复扫 8 个节点。 */
let lastPoolRefreshAt = 0

/** 代理页展示用的内存快照：节点名 → 最近一次真实 grok.com 请求结论（不回读磁盘）。 */
const grokProbeSnapshot = new Map<string, GrokProbeSample>()
/** 本轮已探测结论；比磁盘缓存新时覆盖快照，让失败原因（403/超时）立刻可见。 */
const grokLastAttempts = new Map<string, GrokProbeSample>()

export function getSparkleGrokProbeSnapshot(): GrokProbeSnapshot {
  return Object.fromEntries(grokProbeSnapshot)
}

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function providerFilePath(): string {
  return path.join(profilesDir(), GROK_NODE_PROVIDER_FILENAME)
}

function proxyName(proxy: GrokProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

export async function loadSparkleGrokProbeCache(): Promise<Map<string, GrokNodeProbeRecord>> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      GrokNodeProbeRecord
    >
    const map = new Map<string, GrokNodeProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.alive === 'boolean' &&
        typeof val.rttMs === 'number' &&
        typeof val.checkedAt === 'number'
      ) {
        map.set(key, val)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

async function saveSparkleGrokProbeCache(
  cache: ReadonlyMap<string, GrokNodeProbeRecord>
): Promise<void> {
  await writeFile(
    cacheFilePath(),
    JSON.stringify(Object.fromEntries(cache.entries()), null, 2),
    'utf8'
  )
}

async function loadCurrentGrokProxies(): Promise<GrokProxyRecord[]> {
  const { current } = await getProfileConfig()
  if (!current || current === 'default') {
    return []
  }
  const currentProfile = await getProfile(current)
  return extractProxies(currentProfile) as GrokProxyRecord[]
}

async function readGrokProviderMembers(): Promise<string[]> {
  try {
    const doc = parseYaml<{ proxies?: GrokProxyRecord[] }>(
      await readFile(providerFilePath(), 'utf8')
    )
    return (doc.proxies ?? []).map(proxyName).filter((name) => name.length > 0)
  } catch {
    return []
  }
}

async function writeProviderDocument(proxies: readonly GrokProxyRecord[]): Promise<void> {
  if (proxies.length === 0) {
    return
  }
  const nextMembers = proxies.map(proxyName).filter((name) => name.length > 0)
  const previousMembers = await readGrokProviderMembers()
  await writeFile(providerFilePath(), stringifyYaml({ proxies: [...proxies] }), 'utf8')
  if (grokProviderMembershipChanged(previousMembers, nextMembers)) {
    providerReloadPending = true
  }
}

async function writeGrokProviderFromCache(
  proxies: readonly GrokProxyRecord[],
  cache: GrokNodeProbeCache
): Promise<boolean> {
  const doc = buildSparkleGrokProviderDocument({ proxies, probeCache: cache })
  if (doc.proxies.length === 0) {
    return false
  }
  const nextMembers = doc.proxies.map(proxyName).filter((name) => name.length > 0)
  const previousMembers = await readGrokProviderMembers()
  const membershipChanged = grokProviderMembershipChanged(previousMembers, nextMembers)
  await writeFile(providerFilePath(), stringifyYaml(doc), 'utf8')
  if (membershipChanged) {
    providerReloadPending = true
  }
  return membershipChanged
}

async function reloadGrokProvider(): Promise<void> {
  try {
    await mihomoUpdateProxyProviders(GROK_NODE_PROVIDER_ID)
    providerReloadPending = false
    providerReloadFailing = false
  } catch (error) {
    providerReloadPending = true
    if (!providerReloadFailing) {
      providerReloadFailing = true
      await appendAppLog(
        `[SparkleGrokProbe]: provider reload failed err=${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  }
}

async function ensureGrokProviderReloaded(): Promise<void> {
  if (!providerReloadPending) {
    return
  }
  await reloadGrokProvider()
}

async function resolveMixedPort(): Promise<number> {
  try {
    const config = await getControledMihomoConfig()
    const mixedPort = Number((config as Record<string, unknown>)['mixed-port'])
    return Number.isFinite(mixedPort) && mixedPort > 0 ? mixedPort : 0
  } catch {
    return 0
  }
}

interface RoutedCheckResult {
  ok: boolean
  status: number
  rttMs: number
  reason?: string
}

function recordGrokAttempt(proxy: GrokProxyRecord, check: RoutedCheckResult): void {
  const name = proxyName(proxy)
  if (!name) {
    return
  }
  grokLastAttempts.set(name, {
    state: check.ok ? 'usable' : 'failed',
    rttMs: check.ok ? check.rttMs : 0,
    checkedAt: Date.now(),
    status: check.status,
    ...(check.reason ? { reason: check.reason } : {})
  })
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
  return RECHECK_INTERVAL_MS * Math.min(Math.max(emptyRounds, 0), 3)
}

/** 用「磁盘缓存 + 本轮结论」重建快照；缓存命中但本轮没探测的节点保留上次真实结论。 */
function syncGrokProbeSnapshot(
  proxies: readonly GrokProxyRecord[],
  cache: GrokNodeProbeCache
): void {
  const next = new Map<string, GrokProbeSample>(
    Object.entries(buildGrokProbeSnapshot(proxies, cache))
  )
  for (const [name, attempt] of grokLastAttempts) {
    const current = next.get(name)
    if (current && attempt.checkedAt < current.checkedAt) {
      continue
    }
    next.set(name, attempt)
  }
  grokProbeSnapshot.clear()
  for (const [name, sample] of next) {
    grokProbeSnapshot.set(name, sample)
  }
}

/**
 * 唯一判定口径：真实请求 grok.com。
 * 用 HEAD 只取状态与响应头（实测 HEAD 与 GET 的 403/200 判定一致，且不下载 200KB 页面）。
 * mixed-port > 0 时显式走 HTTP 代理；否则依赖 TUN 直连（请求仍按路由规则进入 grok 专用组）。
 */
async function requestGrokViaRoute(mixedPort: number): Promise<RoutedCheckResult> {
  const startedAt = Date.now()
  try {
    const res = await axios.request({
      method: 'HEAD',
      url: 'https://grok.com/',
      ...(mixedPort > 0
        ? { proxy: { protocol: 'http' as const, host: '127.0.0.1', port: mixedPort } }
        : {}),
      timeout: ROUTED_CHECK_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' }
    })
    const mitigated = String((res.headers as Record<string, unknown>)?.['cf-mitigated'] ?? '')
    const ok = isGrokRoutedResponseUsable(res.status, mitigated)
    return {
      ok,
      status: res.status,
      rttMs: Date.now() - startedAt,
      reason: ok ? undefined : `HTTP ${res.status}${mitigated ? ` cf-mitigated=${mitigated}` : ''}`
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      rttMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

function recordRouted(
  cache: Map<string, GrokNodeProbeRecord>,
  proxy: GrokProxyRecord,
  check: RoutedCheckResult
): void {
  cache.set(computeProxyNodeFingerprint(proxy), {
    alive: true,
    rttMs: check.rttMs,
    checkedAt: Date.now(),
    status: check.status
  })
  recordGrokAttempt(proxy, check)
}

function recordRoutedFailure(
  cache: Map<string, GrokNodeProbeRecord>,
  proxy: GrokProxyRecord,
  check: RoutedCheckResult
): void {
  cache.set(computeProxyNodeFingerprint(proxy), {
    alive: false,
    rttMs: 0,
    checkedAt: Date.now(),
    status: check.status,
    ...(check.reason ? { reason: check.reason } : {})
  })
  recordGrokAttempt(proxy, check)
}

async function currentGrokNode(): Promise<string | null> {
  try {
    const detail = await mihomoGroupDetail(GROK_DEDICATED_GROUP_NAME)
    const now = String(detail?.now ?? '').trim()
    return now.length > 0 ? now : null
  } catch {
    return null
  }
}

/**
 * 非侵入式全量刷新：用 mihomo group-delay(expected=200) 测当前 provider 的全部成员。
 * 不切换选择、不关闭连接，只更新缓存与展示快照；当前节点跳过——它的 60 秒 HEAD 复核更权威。
 */
async function refreshGrokPoolLatency(
  proxies: readonly GrokProxyRecord[],
  cache: Map<string, GrokNodeProbeRecord>,
  currentName: string | null
): Promise<void> {
  const members = new Set(await readGrokProviderMembers())
  if (members.size === 0) {
    return
  }

  const startedAt = Date.now()
  lastPoolRefreshAt = startedAt
  let delays: Record<string, number>
  try {
    delays = await mihomoGroupDelay(GROK_DEDICATED_GROUP_NAME, GROK_DELAY_TEST_URL, {
      timeoutMs: ROUTED_CHECK_TIMEOUT_MS,
      expectedStatus: '200'
    })
  } catch (error) {
    await appendAppLog(
      `[SparkleGrokProbe]: pool refresh failed err=${
        error instanceof Error ? error.message : String(error)
      }\n`
    )
    return
  }

  const byName = new Map<string, GrokProxyRecord>()
  for (const proxy of proxies) {
    const name = proxyName(proxy)
    if (name) {
      byName.set(name, proxy)
    }
  }

  const now = Date.now()
  let ok = 0
  for (const name of members) {
    if (!name || name === currentName) {
      continue
    }
    const proxy = byName.get(name)
    if (!proxy) {
      continue
    }
    const delay = Number(delays?.[name])
    if (Number.isFinite(delay) && delay > 0) {
      ok += 1
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: true,
        rttMs: delay,
        checkedAt: now,
        status: 200
      })
    } else {
      cache.set(computeProxyNodeFingerprint(proxy), {
        alive: false,
        rttMs: 0,
        checkedAt: now,
        reason: 'group-delay 未通过（超时或 403 挑战）'
      })
    }
  }

  await saveSparkleGrokProbeCache(cache)
  syncGrokProbeSnapshot(proxies, cache)
  await appendAppLog(
    `[SparkleGrokProbe]: pool refresh members=${members.size} ok=${ok} elapsed=${
      Date.now() - startedAt
    }ms\n`
  )
}

async function switchGrokNode(node: string): Promise<boolean> {
  const switched = await mihomoChangeProxy(GROK_DEDICATED_GROUP_NAME, node).catch(() => false)
  if (!switched) {
    return false
  }
  await mihomoCloseConnections(GROK_DEDICATED_GROUP_NAME).catch(() => undefined)
  return true
}

/** 切换并做真实请求验证；只有 routed 通过才写入 alive。 */
async function tryNode(
  proxy: GrokProxyRecord,
  mixedPort: number,
  cache: Map<string, GrokNodeProbeRecord>
): Promise<boolean> {
  const name = proxyName(proxy)
  if (!name) {
    return false
  }
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
  const first = proxyName(selected.proxies[0])
  await appendAppLog(
    `[SparkleGrokProbe]: discovery probed=${probed} working=${working.length} pool=${selected.proxies.length}\n`
  )
  return first && (await switchGrokNode(first)) ? first : null
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
  const currentProxy = current ? proxies.find((proxy) => proxyName(proxy) === current) : undefined
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
    const name = proxyName(proxy)
    if (!name || name === current) {
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
    if (Date.now() - lastPoolRefreshAt >= POOL_REFRESH_INTERVAL_MS) {
      await refreshGrokPoolLatency(proxies, cache, await currentGrokNode())
    }

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
