// [INPUT] 当前订阅节点 · 地区优先级 · agy（daily-cloudcode-pa）真实请求探测缓存
// [OUTPUT] AGY_NODE_PROVIDER_ID · orderAgyProxies · orderAgyRepairProxies · buildSparkleAgyProviderDocument · buildAgyGroupConfig
// [POS] `🎯 agy 专用` 的专属 provider：只收录通过了真实 agy 请求（HTTP 200）的节点。
// 为什么不能复用 gemini.google.com 探测：cloudcode-pa 的地域校验发生在认证之后，无凭证请求
// 只会拿到 401，无法区分「地区被拒」与「未认证」；只有让 magpie 真的发一次请求才能判定。

import { isAnyTlsProxyType } from './autoSelectAnyTlsExclusionCore'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'

export const AGY_NODE_PROVIDER_ID = 'sparkle-agy' as const
export const AGY_NODE_PROVIDER_FILENAME = 'sparkle-agy-proxies.yaml' as const

export type AgyProxyRecord = Record<string, unknown>

export interface AgyNodeProbeRecord {
  /** 只有真实 agy 请求返回 200 才是 true；明确的 `User location is not supported` 为 false。 */
  usable: boolean
  /** 探测往返耗时，用于同一地区段内排序。 */
  rttMs: number
  checkedAt: number
}

export type AgyNodeProbeCache = ReadonlyMap<string, AgyNodeProbeRecord>

/**
 * 真实 agy 请求的判定结果：
 * - `usable`：HTTP 200，节点确实能过 cloudcode-pa；
 * - `unusable`：明确的 `User location is not supported`，这个出口被 Google 拒绝；
 * - `unknown`：限流/超时/其它 4xx，不足以给节点定性；
 * - `fatal`：magpie 侧问题（模型不存在等），继续测其他节点没有意义。
 */
export type AgyProbeVerdict = 'usable' | 'unusable' | 'unknown' | 'fatal'

const LOCATION_VIOLATION_MARKER = 'location is not supported'

export function classifyAgyProbeResponse(status: number, body: string): AgyProbeVerdict {
  if (status === 200) {
    return 'usable'
  }
  if (status === 400 && body.toLowerCase().includes(LOCATION_VIOLATION_MARKER)) {
    return 'unusable'
  }
  if (status === 404 || status === 405) {
    return 'fatal'
  }
  return 'unknown'
}

export interface AgyProxyGroupShape {
  name: string
  type: string
  proxies?: string[]
  use?: string[]
}

function proxyName(proxy: AgyProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

/** 单个节点是否可能进 agy 池：命名有效、非 AnyTLS、非香港（香港不在 Antigravity 地区可用表内）。 */
export function isEligibleAgyNode(proxy: AgyProxyRecord): boolean {
  const name = proxyName(proxy)
  if (!name || isAnyTlsProxyType(String(proxy.type ?? ''))) {
    return false
  }
  return !isBlockedRegionNodeName(name)
}

/**
 * 候选池：去重 + 剔除 AnyTLS（Sparkle 全局约定）+ 剔除香港
 * （香港不在 Antigravity 的地区可用表内，进池只会白白浪费一次探测）。
 */
export function collectEligibleAgyProxies(proxies: readonly AgyProxyRecord[]): AgyProxyRecord[] {
  const seen = new Set<string>()
  const eligible: AgyProxyRecord[] = []
  for (const proxy of proxies) {
    if (!isEligibleAgyNode(proxy)) {
      continue
    }
    const name = proxyName(proxy)
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    eligible.push(proxy)
  }
  return eligible
}

/** 地区优先级分段 + 段内按实测往返耗时升序；无样本的节点垫在最后，避免未测节点挡住已验证节点。 */
function orderByRegion(
  candidates: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: AgyNodeProbeCache
): AgyProxyRecord[] {
  const included = new Set<string>()
  const ordered: AgyProxyRecord[] = []
  const unsampled: AgyProxyRecord[] = []

  const take = (matches: (name: string) => boolean): void => {
    const sampled: AgyProxyRecord[] = []
    for (const proxy of candidates) {
      const name = proxyName(proxy)
      if (!name || included.has(name) || !matches(name)) {
        continue
      }
      included.add(name)
      const record = probeCache?.get(computeProxyNodeFingerprint(proxy))
      if (record?.usable === true) {
        sampled.push(proxy)
      } else {
        unsampled.push(proxy)
      }
    }
    sampled.sort((a, b) => {
      const rttA = probeCache?.get(computeProxyNodeFingerprint(a))?.rttMs ?? 0
      const rttB = probeCache?.get(computeProxyNodeFingerprint(b))?.rttMs ?? 0
      return rttA - rttB
    })
    ordered.push(...sampled)
  }

  for (const region of regionPriority) {
    take((name) => nodeMatchesRegion(name, region))
  }
  take(() => true)

  return [...ordered, ...unsampled]
}

/**
 * 生成 `sparkle-agy` provider 的节点集合：
 * 1. 有已验证可用节点时，**只**返回这些节点（“只包含能正常访问 agy 的节点”）；
 * 2. 尚无结论（冷启动 / 缓存过期）时，返回「未被确认不可用」的候选，保证 provider 不为空；
 * 3. 全部被确认不可用时仍然返回候选池 —— mihomo 拒绝加载空 provider，
 *    此时由探测模块写日志告警，而不是让整份配置加载失败。
 */
export function orderAgyProxies(
  proxies: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  probeCache?: AgyNodeProbeCache
): AgyProxyRecord[] {
  const eligible = collectEligibleAgyProxies(proxies)
  if (eligible.length === 0) {
    return []
  }

  const verified = eligible.filter(
    (proxy) => probeCache?.get(computeProxyNodeFingerprint(proxy))?.usable === true
  )
  if (verified.length > 0) {
    return orderByRegion(verified, regionPriority, probeCache)
  }

  const notConfirmedUnusable = eligible.filter(
    (proxy) => probeCache?.get(computeProxyNodeFingerprint(proxy))?.usable !== false
  )
  const pool = notConfirmedUnusable.length > 0 ? notConfirmedUnusable : eligible
  return orderByRegion(pool, regionPriority, probeCache)
}

/** 最近 30 分钟内验证过可用的记录才算「新鲜证据」，超过这个窗口的旧结论不参与排序加权。 */
const FRESH_VERIFIED_MS = 30 * 60 * 1000

/** 本轮修复扫描刚试过的节点在 15 分钟内降级到「已尝试」组，保证下一轮先试没试过的候选（防止超时节点饿死后面的地区）。 */
const REPAIR_ATTEMPT_WINDOW_MS = 15 * 60 * 1000

/** 同一地区内：最近 30 分钟验证过的按 rtt 在前，其余保持订阅顺序。 */
function prioritizeFreshWithinRegion(
  bucket: readonly AgyProxyRecord[],
  probeCache: AgyNodeProbeCache | undefined,
  nowMs: number
): AgyProxyRecord[] {
  const fresh: AgyProxyRecord[] = []
  const others: AgyProxyRecord[] = []
  for (const proxy of bucket) {
    const record = probeCache?.get(computeProxyNodeFingerprint(proxy))
    if (record?.usable === true && nowMs - record.checkedAt < FRESH_VERIFIED_MS) {
      fresh.push(proxy)
    } else {
      others.push(proxy)
    }
  }
  fresh.sort((a, b) => {
    const rttA = probeCache?.get(computeProxyNodeFingerprint(a))?.rttMs ?? 0
    const rttB = probeCache?.get(computeProxyNodeFingerprint(b))?.rttMs ?? 0
    return rttA - rttB
  })
  return [...fresh, ...others]
}

/** 严格按地区优先级分段（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余）。 */
function orderWithinRegions(
  candidates: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  probeCache: AgyNodeProbeCache | undefined,
  nowMs: number
): AgyProxyRecord[] {
  const buckets: AgyProxyRecord[][] = regionPriority.map(() => [])
  const rest: AgyProxyRecord[] = []
  for (const proxy of candidates) {
    const name = proxyName(proxy)
    const regionIndex = regionPriority.findIndex((region) => nodeMatchesRegion(name, region))
    if (regionIndex >= 0) {
      buckets[regionIndex]!.push(proxy)
    } else {
      rest.push(proxy)
    }
  }
  return [
    ...buckets.flatMap((bucket) => prioritizeFreshWithinRegion(bucket, probeCache, nowMs)),
    ...prioritizeFreshWithinRegion(rest, probeCache, nowMs)
  ]
}

/**
 * 修复巡检顺序：**严格按地区优先级**（台湾 → 日本 → 韩国 → 新加坡 → 美国 → 其余），
 * 已确认不可用的节点统一排到最后；地区内优先「最近 30 分钟验证过」的节点（按 rtt），其余保持订阅顺序。
 *
 * 进度保证：`attempted` 记录本轮/近期刚试过的节点（含超时这种「不下结论」的），
 * 这些节点会被降级到「已尝试」组，下一轮先试没试过的候选 —— 否则 12 个全超时的 TW/JP 候选
 * 会把后面的地区永久饿死（超时不会写缓存，下一轮还是同一批）。
 */
export function orderAgyRepairProxies(
  proxies: readonly AgyProxyRecord[],
  regionPriority: readonly string[],
  probeCache: AgyNodeProbeCache | undefined,
  limit: number,
  nowMs: number = Date.now(),
  attempted?: ReadonlyMap<string, number>
): AgyProxyRecord[] {
  const eligible = collectEligibleAgyProxies(proxies)
  const rejected: AgyProxyRecord[] = []
  const untried: AgyProxyRecord[] = []
  const recentlyTried: AgyProxyRecord[] = []

  for (const proxy of eligible) {
    const fingerprint = computeProxyNodeFingerprint(proxy)
    if (probeCache?.get(fingerprint)?.usable === false) {
      rejected.push(proxy)
      continue
    }
    const lastAttempt = attempted?.get(fingerprint) ?? 0
    if (lastAttempt > 0 && nowMs - lastAttempt < REPAIR_ATTEMPT_WINDOW_MS) {
      recentlyTried.push(proxy)
    } else {
      untried.push(proxy)
    }
  }

  const ordered = [
    ...orderWithinRegions(untried, regionPriority, probeCache, nowMs),
    ...orderWithinRegions(recentlyTried, regionPriority, probeCache, nowMs),
    ...rejected
  ]

  const max = Math.max(0, Math.floor(limit))
  return ordered.slice(0, max)
}

export function buildAgyProbeSnapshot(
  proxies: readonly AgyProxyRecord[],
  probeCache: AgyNodeProbeCache | undefined
): Record<string, { rttMs: number; checkedAt: number }> {
  const snapshot: Record<string, { rttMs: number; checkedAt: number }> = {}
  for (const proxy of proxies) {
    const name = proxyName(proxy)
    const record = probeCache?.get(computeProxyNodeFingerprint(proxy))
    if (name && record?.usable === true) {
      snapshot[name] = { rttMs: record.rttMs, checkedAt: record.checkedAt }
    }
  }
  return snapshot
}

export function buildSparkleAgyProviderDocument(input: {
  proxies: readonly AgyProxyRecord[]
  regionPriority: readonly string[]
  probeCache?: AgyNodeProbeCache
}): { proxies: AgyProxyRecord[] } {
  return {
    proxies: orderAgyProxies(input.proxies, input.regionPriority, input.probeCache)
  }
}

/**
 * `🎯 agy 专用` 用 select（不是 fallback/url-test）：agy 的失败是应用层 400，
 * mihomo 的探活（gemini.google.com / 204）根本看不见，自动降级只会把流量甩到下一个同样不可用的节点，
 * 因此这里保持确定性出口，只在探测确认当前节点不可用时才切换。
 */
export function buildAgyGroupConfig(
  leafNames: readonly string[],
  profileId: string | undefined
): AgyProxyGroupShape | null {
  if (profileId) {
    // 没有叶子节点时 provider 文件不会被写出；此时建组会让 mihomo 引用不存在的 provider。
    if (leafNames.length === 0) {
      return null
    }
    return {
      name: AGY_DEDICATED_GROUP_NAME,
      type: 'select',
      use: [AGY_NODE_PROVIDER_ID]
    }
  }

  const members = leafNames.map((name) => name.trim()).filter((name) => name && !isBlockedRegionNodeName(name))
  if (members.length === 0) {
    return null
  }
  return {
    name: AGY_DEDICATED_GROUP_NAME,
    type: 'select',
    proxies: members
  }
}
