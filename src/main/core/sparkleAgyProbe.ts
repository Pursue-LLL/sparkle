// [INPUT] 当前订阅节点 · `🎯 agy 专用` 组 · magpie 本地网关 127.0.0.1:3425 · sparkle-agy-nodes.json
// [OUTPUT] loadSparkleAgyProbeCache · bootstrapSparkleAgyProvider · startSparkleAgyProbeLoop
// [POS] 用**真实 agy 请求**给节点定性：200 = 可用，400 `User location is not supported` = 不可用。
// 为什么不能像 Gemini 探测那样直接打目标站：cloudcode-pa 的地域校验在认证之后，
// 无凭证请求只会返回 401 CREDENTIALS_MISSING（已实测），无法区分「地区被拒」与「未认证」。
// 因此只能借 magpie（持有账号凭证）发一次 1-token 请求，结果写入缓存并驱动 sparkle-agy provider。

import http from 'node:http'
import { performance } from 'node:perf_hooks'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { mihomoChangeProxy, mihomoGroupDetail, mihomoUpdateProxyProviders } from './mihomoApi'
import { extractProxies } from './provider'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  AGY_NODE_PROVIDER_FILENAME,
  AGY_NODE_PROVIDER_ID,
  buildSparkleAgyProviderDocument,
  classifyAgyProbeResponse,
  collectEligibleAgyProxies,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { runAgyAudit, resolveAgyAuditBackoffMs, type AgyAuditOutcome } from './sparkleAgyProbeCore'

const CACHE_FILENAME = 'sparkle-agy-nodes.json'
const USABLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
/**
 * 不可用结论只保持 30 分钟：实测这种 400 是**时变**的（同节点 20 分钟内 400 → 200），
 * 缓存太久会让节点被误判封死半天。
 */
const UNUSABLE_CACHE_TTL_MS = 30 * 60 * 1000
/** 轮询间隔只决定"多久检查一次有没有过期节点"，真正的重测频率由上面两个 TTL 控制。 */
const AUDIT_INTERVAL_MS = 15 * 60 * 1000
/** 单轮最多探测多少个节点：避免一次把几十个请求打给 magpie/Google 触发风控。 */
const MAX_PROBES_PER_AUDIT = 8

const MAGPIE_BASE_URL = 'http://127.0.0.1:3425'
const MAGPIE_API_KEY = 'magpie'
const MAGPIE_MODEL_PREFIX = 'antigravity/'
const PROBE_TIMEOUT_MS = 20_000
/** 整轮巡检预算：超时节点会逐个吃掉探测超时，不能让「临时扩大 provider」的窗口无限拉长。 */
const AUDIT_BUDGET_MS = 8 * 60 * 1000

type MagpieResponse =
  | { kind: 'response'; status: number; body: string }
  /** 本地网关没起来（magpie 未启动）——继续测没有任何意义。 */
  | { kind: 'unreachable' }
  /** 单个节点的请求超时——只代表这个节点慢，不代表必须中止整轮巡检。 */
  | { kind: 'timeout' }

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function isCacheRecordFresh(record: AgyNodeProbeRecord, nowMs: number): boolean {
  const ttl = record.usable ? USABLE_CACHE_TTL_MS : UNUSABLE_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleAgyProbeCache(
  nowMs: number = Date.now()
): Promise<Map<string, AgyNodeProbeRecord>> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      AgyNodeProbeRecord
    >
    const map = new Map<string, AgyNodeProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.usable === 'boolean' &&
        typeof val.rttMs === 'number' &&
        typeof val.checkedAt === 'number' &&
        isCacheRecordFresh(val, nowMs)
      ) {
        map.set(key, val)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

async function saveSparkleAgyProbeCache(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}

function requestMagpie(
  urlPath: string,
  payload?: unknown,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<MagpieResponse> {
  return new Promise((resolve) => {
    const url = new URL(`${MAGPIE_BASE_URL}${urlPath}`)
    const body = payload === undefined ? undefined : JSON.stringify(payload)
    let settled = false
    const timeoutState: { timer?: NodeJS.Timeout } = {}

    const finish = (value: MagpieResponse): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutState.timer) {
        clearTimeout(timeoutState.timer)
      }
      resolve(value)
    }

    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${MAGPIE_API_KEY}`,
          'content-length': String(Buffer.byteLength(body ?? ''))
        }
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          // 只需要看得到错误信息，正文超长时截断避免占内存。
          if (text.length < 8192) {
            text += chunk.slice(0, 8192 - text.length)
          }
        })
        response.on('end', () =>
          finish({ kind: 'response', status: response.statusCode ?? 0, body: text })
        )
        response.on('error', () => finish({ kind: 'unreachable' }))
      }
    )

    timeoutState.timer = setTimeout(() => {
      request.destroy()
      finish({ kind: 'timeout' })
    }, timeoutMs)

    request.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND'
          ? { kind: 'unreachable' }
          : { kind: 'timeout' }
      )
    })

    if (body !== undefined) {
      request.write(body)
    }
    request.end()
  })
}

/** 从 magpie 的 OpenAI 兼容接口里挑一个 antigravity 模型（优先最便宜的 flash）。 */
async function discoverAgyModel(): Promise<string | null> {
  const response = await requestMagpie('/v1/models', undefined, 5000)
  if (response.kind !== 'response' || response.status !== 200) {
    return null
  }
  try {
    const parsed = JSON.parse(response.body) as { data?: Array<{ id?: string }> }
    const ids = (parsed.data ?? [])
      .map((model) => String(model.id ?? '').trim())
      .filter((id) => id.startsWith(MAGPIE_MODEL_PREFIX))
    return ids.find((id) => id.includes('flash')) ?? ids[0] ?? null
  } catch {
    return null
  }
}

async function probeSingleNode(node: string, model: string): Promise<AgyAuditOutcome> {
  const switched = await mihomoChangeProxy(AGY_DEDICATED_GROUP_NAME, node).catch(() => false)
  if (!switched) {
    // 典型原因：该节点已被订阅移除，或组尚未生成 —— 跳过它，不要因为单个节点中止整轮巡检。
    return { verdict: 'unknown', rttMs: 0, fatal: false }
  }

  const startMs = performance.now()
  const response = await requestMagpie('/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false
  })
  const rttMs = Math.max(1, Math.round(performance.now() - startMs))

  if (response.kind === 'unreachable') {
    return { verdict: 'unknown', rttMs: 0, fatal: true }
  }
  if (response.kind === 'timeout') {
    return { verdict: 'unknown', rttMs, fatal: false }
  }
  const verdict = classifyAgyProbeResponse(response.status, response.body)
  return { verdict, rttMs, fatal: verdict === 'fatal' }
}

function countUsable(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>,
  proxies: readonly AgyProxyRecord[]
): number {
  return proxies.filter(
    (proxy) => cache.get(computeProxyNodeFingerprint(proxy))?.usable === true
  ).length
}

async function writeProviderFromCache(
  proxies: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  cache?: ReadonlyMap<string, AgyNodeProbeRecord>
): Promise<string[]> {
  const document = buildSparkleAgyProviderDocument({
    proxies,
    regionPriority,
    probeCache: cache
  })
  if (document.proxies.length === 0) {
    return []
  }
  await writeFile(
    path.join(profilesDir(), AGY_NODE_PROVIDER_FILENAME),
    stringifyYaml(document),
    'utf8'
  )
  return document.proxies
    .map((proxy) => String(proxy.name ?? '').trim())
    .filter((name) => name.length > 0)
}

/** 当前固定节点仍在可用集合内时不打扰用户的手动选择，否则落到首选节点。 */
async function ensureAgySelection(ordered: readonly string[]): Promise<void> {
  const preferred = ordered[0]
  if (!preferred) {
    return
  }
  try {
    const detail = await mihomoGroupDetail(AGY_DEDICATED_GROUP_NAME)
    const now = String(detail?.now ?? '').trim()
    if (now && ordered.includes(now)) {
      return
    }
    await mihomoChangeProxy(AGY_DEDICATED_GROUP_NAME, preferred)
  } catch {
    // 组尚未生成（首次配置生成前）时忽略，下一轮巡检会补上。
  }
}

async function reloadProvider(ordered: readonly string[], selectPreferred: boolean): Promise<void> {
  if (ordered.length === 0) {
    return
  }
  try {
    await mihomoUpdateProxyProviders(AGY_NODE_PROVIDER_ID)
  } catch {
    return
  }
  if (selectPreferred) {
    await ensureAgySelection(ordered)
  }
}

let probeInFlight = false
/** 连续全灭轮次 → 用于指数退避，避免在 Google 的冷却窗口里越试越久。 */
let consecutiveEmptyRounds = 0
let agyAuditSkipUntilMs = 0

export async function bootstrapSparkleAgyProvider(): Promise<void> {
  if (probeInFlight || Date.now() < agyAuditSkipUntilMs) {
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

    // 先用缓存恢复上次的可用集合，保证启动后 agy 立刻有出口。
    const cachedUsable = countUsable(cache, proxies)
    if (cachedUsable > 0) {
      const restored = await writeProviderFromCache(proxies, regionPriority, cache)
      await reloadProvider(restored, true)
      await appendAppLog(`[SparkleAgyProbe]: restored ${cachedUsable} verified nodes from cache\n`)
    }

    const nowMs = Date.now()
    const pending = collectEligibleAgyProxies(proxies)
      .filter((proxy) => {
        const record = cache.get(computeProxyNodeFingerprint(proxy))
        return !record || !isCacheRecordFresh(record, nowMs)
      })
      // 先测最久没测过的（含从未测过的），保证被阻塞的节点也能在几轮内轮到。
      .sort((a, b) => {
        const ra = cache.get(computeProxyNodeFingerprint(a))?.checkedAt ?? 0
        const rb = cache.get(computeProxyNodeFingerprint(b))?.checkedAt ?? 0
        return ra - rb
      })
      .slice(0, MAX_PROBES_PER_AUDIT)
    if (pending.length === 0) {
      return
    }

    // 只有确实需要巡检时才联系 magpie，避免每轮空转。
    const model = await discoverAgyModel()
    if (!model) {
      await appendAppLog(
        '[SparkleAgyProbe]: magpie gateway unreachable or exposes no antigravity model, skip audit\n'
      )
      return
    }

    // 巡检要逐个切到候选节点，而 mihomo 只能切到 provider 里存在的节点：
    // 先把全量候选写进 provider（此时不改当前选择，线上出口保持不变），巡检结束再收敛回已验证集合。
    const expanded = await writeProviderFromCache(proxies, regionPriority, undefined)
    await reloadProvider(expanded, false)

    const audit = await runAgyAudit(
      { pending, cache, budgetMs: AUDIT_BUDGET_MS },
      { probeNode: (nodeName) => probeSingleNode(nodeName, model) }
    )

    if (audit.probed > 0) {
      await saveSparkleAgyProbeCache(cache)
    }
    // 无论本轮是否得到新结论，都要把 provider 收敛回「已验证可用集合」（巡检前临时扩过）
    const ordered = await writeProviderFromCache(proxies, regionPriority, cache)
    await reloadProvider(ordered, true)

    if (audit.probed === 0) {
      return
    }
    consecutiveEmptyRounds = audit.usable === 0 ? consecutiveEmptyRounds + 1 : 0
    agyAuditSkipUntilMs = Date.now() + resolveAgyAuditBackoffMs(AUDIT_INTERVAL_MS, consecutiveEmptyRounds)
    const verified = countUsable(cache, proxies)
    await appendAppLog(
      `[SparkleAgyProbe]: probed=${audit.probed} usable=${audit.usable} verified=${verified} pool=${ordered.length}${audit.aborted ? ' aborted' : ''} empty_rounds=${consecutiveEmptyRounds}\n`
    )
    if (verified === 0) {
      // 全灭时保留候选池只是为了避免空 provider 让整份配置加载失败，并不代表 agy 能用。
      await appendAppLog(
        '[SparkleAgyProbe]: WARN no node passed the real agy check; agy traffic will still hit 400 (line/exit blocked by Google)\n'
      )
    }
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
  }, AUDIT_INTERVAL_MS)
  agyProbeTimer.unref()
}
