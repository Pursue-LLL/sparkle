// [INPUT] sparkleMailPortProbe::withLocalProbeChannelLock (POS: 邮件/Gemini 共享探测通道) ·
//         sparkleGeminiStreamProbe::streamProbeGeminiRegionViaLocalListener (POS: 流式地区探测) · 当前订阅节点 · sparkle-gemini-nodes.json
// [OUTPUT] loadSparkleGeminiRegionCache · loadGeminiBlockedNodeNames · verifyNodeGeminiRegion · bootstrapSparkleGeminiRegionAudit · startSparkleGeminiRegionAuditLoop
// [POS] 识别「HTTP 200 但被 Google GeoIP 判定为送中/不支持地区（如 vXmutd="ZZ"/"CN"/"HK" 或 google.cn）」的节点，
// 将确认锁区/送中的节点从 `sparkle-fast-proxies.yaml`（`自动选择`）中剔除并热重载。
// 网络超时或连接瞬断绝不误判为锁区（仅当明确提取到不支持的地区码时才记入锁区缓存）。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import {
  mihomoGroupDetail,
  mihomoProxyProviders,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID
} from './sparkleFastProviderCore'
import { resolveGeminiBlockedNodeNames, type GeminiRegionProbeRecord } from './sparkleGeminiProbeCore'
import { streamProbeGeminiRegionViaLocalListener } from './sparkleGeminiStreamProbe'
import type { MailProxyRecord } from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { withLocalProbeChannelLock } from './sparkleMailPortProbe'

const CACHE_FILENAME = 'sparkle-gemini-nodes.json'
const ELIGIBLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
const INELIGIBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const AUDIT_INTERVAL_MS = 30 * 60 * 1000

let memoryCache: Map<string, GeminiRegionProbeRecord> | null = null

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function isRecordFresh(record: GeminiRegionProbeRecord, nowMs: number): boolean {
  const ttl = record.eligible ? ELIGIBLE_CACHE_TTL_MS : INELIGIBLE_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleGeminiRegionCache(
  nowMs: number = Date.now()
): Promise<Map<string, GeminiRegionProbeRecord>> {
  if (memoryCache) {
    for (const [key, val] of memoryCache.entries()) {
      if (!isRecordFresh(val, nowMs)) {
        memoryCache.delete(key)
      }
    }
    return memoryCache
  }
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      GeminiRegionProbeRecord
    >
    const map = new Map<string, GeminiRegionProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.eligible === 'boolean' &&
        typeof val.countryCode === 'string' &&
        typeof val.checkedAt === 'number' &&
        isRecordFresh(val, nowMs)
      ) {
        map.set(key, val)
      }
    }
    memoryCache = map
    return map
  } catch {
    memoryCache = new Map()
    return memoryCache
  }
}

async function saveSparkleGeminiRegionCache(
  cache: ReadonlyMap<string, GeminiRegionProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}

export async function loadGeminiBlockedNodeNames(
  proxies?: readonly MailProxyRecord[]
): Promise<Set<string>> {
  const cache = await loadSparkleGeminiRegionCache()
  if (cache.size === 0) {
    return new Set()
  }
  let targetProxies = proxies
  if (!targetProxies) {
    try {
      const { current } = await getProfileConfig()
      if (current && current !== 'default') {
        const currentProfile = await getProfile(current)
        targetProxies = extractProxies(currentProfile) as MailProxyRecord[]
      }
    } catch {
      targetProxies = undefined
    }
  }
  if (targetProxies && targetProxies.length > 0) {
    return resolveGeminiBlockedNodeNames(targetProxies, cache)
  }
  const fallback = new Set<string>()
  for (const [key, rec] of cache.entries()) {
    if (!rec.eligible && !key.includes('|')) {
      fallback.add(key)
    }
  }
  if (fallback.size === 0) {
    for (const [key, rec] of cache.entries()) {
      if (!rec.eligible) {
        const parts = key.split('|')
        const name = parts.length >= 4 ? parts.slice(0, -3).join('|') : key
        if (name) fallback.add(name)
      }
    }
  }
  return fallback
}

async function resolveCurrentProfileProxies(): Promise<MailProxyRecord[]> {
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return []
    }
    const currentProfile = await getProfile(current)
    return extractProxies(currentProfile) as MailProxyRecord[]
  } catch {
    return []
  }
}

/** 当新发现锁区/送中节点时，立即重写 `sparkle-fast-proxies.yaml` 并通知 mihomo 热重载。 */
export async function rebuildAndReloadSparkleFastProvider(): Promise<void> {
  try {
    const proxies = await resolveCurrentProfileProxies()
    if (proxies.length === 0) {
      return
    }
    const { proxySwitchPriority = [] } = await getAppConfig()
    const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
    const [delaySnapshot, blockedNodeNames] = await Promise.all([
      loadSparkleFastDelaySnapshot(proxies),
      loadGeminiBlockedNodeNames(proxies)
    ])
    const doc = buildSparkleFastProviderDocument({
      proxies,
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
      delayMs: delaySnapshot.size > 0 ? delaySnapshot : undefined,
      blockedNodeNames
    })
    await writeFile(
      path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME),
      stringifyYaml(doc),
      'utf8'
    )
    await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
    const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (group.fixed && blockedNodeNames.has(group.fixed)) {
      await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: rebuild sparkle-fast failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

/**
 * 校验单个节点是否真正解锁 Gemini 地区限制（非送中/锁区）：
 * - 命中缓存时直接 O(1) 返回；
 * - 未命中缓存时通过隐藏探测监听器流式检查 `https://gemini.google.com/app` 的 `vXmutd` 地区码；
 * - 若确认锁区（如 `ZZ`/`CN`/`HK`），立即记入黑名单并触发 `sparkle-fast` 热重载剔除该节点。
 */
export async function verifyNodeGeminiRegion(
  nodeName: string,
  options?: { skipProviderReloadOnReject?: boolean }
): Promise<{ eligible: boolean; countryCode?: string; definitive: boolean }> {
  const trimmed = nodeName.trim()
  if (!trimmed) {
    return { eligible: true, definitive: false }
  }

  const cache = await loadSparkleGeminiRegionCache()
  const proxies = await resolveCurrentProfileProxies()
  const matchedProxy = proxies.find((p) => String(p.name ?? '').trim() === trimmed)
  const cacheKey = matchedProxy ? computeProxyNodeFingerprint(matchedProxy) : trimmed

  const existing = cache.get(cacheKey) ?? cache.get(trimmed)
  if (existing) {
    return {
      eligible: existing.eligible,
      countryCode: existing.countryCode,
      definitive: true
    }
  }

  try {
    const res = await withLocalProbeChannelLock(trimmed, () =>
      streamProbeGeminiRegionViaLocalListener()
    )
    if (!res.definitive || !res.countryCode) {
      return { eligible: true, definitive: false }
    }

    const record: GeminiRegionProbeRecord = {
      eligible: res.eligible,
      countryCode: res.countryCode,
      checkedAt: Date.now()
    }
    cache.set(cacheKey, record)
    cache.set(trimmed, record)
    await saveSparkleGeminiRegionCache(cache)

    if (!res.eligible) {
      await appendAppLog(
        `[SparkleGeminiProbe]: evicted region-restricted node "${trimmed}" (region=${res.countryCode})\n`
      )
      if (!options?.skipProviderReloadOnReject) {
        await rebuildAndReloadSparkleFastProvider()
      }
    } else {
      await appendAppLog(
        `[SparkleGeminiProbe]: verified eligible node "${trimmed}" (region=${res.countryCode})\n`
      )
    }

    return {
      eligible: res.eligible,
      countryCode: res.countryCode,
      definitive: true
    }
  } catch {
    return { eligible: true, definitive: false }
  }
}

let auditInFlight = false

/**
 * 后台巡检 `sparkle-fast` 中 mihomo 判定为 `alive: true` 但尚未缓存 Gemini 地区码的节点，
 * 提前把潜伏的“送中”节点剔除出 `自动选择` 候选池。
 */
export async function bootstrapSparkleGeminiRegionAudit(): Promise<void> {
  if (auditInFlight) {
    return
  }
  auditInFlight = true
  try {
    const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
    const leaves = provider?.proxies ?? []
    if (leaves.length === 0) {
      return
    }

    const cache = await loadSparkleGeminiRegionCache()
    const proxies = await resolveCurrentProfileProxies()
    const fingerprintByName = new Map<string, string>()
    for (const p of proxies) {
      const n = String(p.name ?? '').trim()
      if (n) fingerprintByName.set(n, computeProxyNodeFingerprint(p))
    }

    const unverifiedAliveNames = leaves
      .filter((leaf) => {
        const alive = leaf.extra?.[AUTO_SELECT_GEMINI_PROBE_URL]?.alive ?? leaf.alive
        if (!alive) return false
        const fp = fingerprintByName.get(leaf.name)
        return !(fp && cache.has(fp)) && !cache.has(leaf.name)
      })
      .map((leaf) => leaf.name)

    if (unverifiedAliveNames.length === 0) {
      return
    }

    let newlyRejected = 0
    for (const name of unverifiedAliveNames) {
      const res = await verifyNodeGeminiRegion(name, { skipProviderReloadOnReject: true })
      if (res.definitive && !res.eligible) {
        newlyRejected += 1
      }
    }

    if (newlyRejected > 0) {
      await rebuildAndReloadSparkleFastProvider()
      await appendAppLog(
        `[SparkleGeminiProbe]: audit finished probed=${unverifiedAliveNames.length} newly_evicted=${newlyRejected}\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: audit error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    auditInFlight = false
  }
}

let geminiAuditTimer: NodeJS.Timeout | undefined

export function startSparkleGeminiRegionAuditLoop(): void {
  if (geminiAuditTimer) {
    return
  }
  geminiAuditTimer = setInterval(() => {
    bootstrapSparkleGeminiRegionAudit().catch(() => undefined)
  }, AUDIT_INTERVAL_MS)
  geminiAuditTimer.unref()
}
