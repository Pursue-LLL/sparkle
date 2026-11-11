// [INPUT] 当前订阅节点 · grok.com HTTP 200 探测缓存
// [OUTPUT] GROK_NODE_PROVIDER_ID / GROK_NODE_PROVIDER_FILENAME · buildSparkleGrokProviderDocument · buildGrokProbeSnapshot · orderGrokRepairCandidates · grokProviderMembershipChanged
// [POS] `grok 专用` 的 provider 文档与代理页快照：provider 只保留 routed 验证通过（真实 HEAD 200 且无 cf-mitigated）的节点，
//       非香港优先、按 RTT 升序、最多 12 个；缓存为空或全部节点失败时回退全量，保证 provider 永不为空（mihomo 拒绝空 provider）。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

export const GROK_NODE_PROVIDER_ID = 'sparkle-grok' as const
export const GROK_NODE_PROVIDER_FILENAME = 'sparkle-grok-proxies.yaml' as const

export type GrokProxyRecord = Record<string, unknown>

/**
 * 选路判定的唯一口径：通过 App 的 mixed-port 真实请求 grok.com 的结果。
 * Cloudflare 对不可信出口回 403 + cf-mitigated: challenge；只有 200 且无 challenge 才算可用。
 */
export function isGrokRoutedResponseUsable(status: number, mitigatedHeader = ''): boolean {
  if (status !== 200) {
    return false
  }
  return !String(mitigatedHeader).toLowerCase().includes('challenge')
}

export interface GrokNodeProbeRecord {
  alive: boolean
  rttMs: number
  checkedAt: number
  /** 真实请求的 HTTP 状态；0 表示超时/连接失败。 */
  status?: number
  /** 失败原因（HTTP 403 challenge / 超时…），供代理页如实展示。 */
  reason?: string
}

/** 代理页展示用的单节点实测结论。 */
export interface GrokProbeSample {
  rttMs: number
  checkedAt: number
  state: 'usable' | 'failed'
  status?: number
  reason?: string
}

export type GrokProbeSnapshot = Record<string, GrokProbeSample>

export type GrokNodeProbeCache = ReadonlyMap<string, GrokNodeProbeRecord>

/** 池子信任 24 小时内的存活样本；更旧的样本视为不可信，回退全量交由 health-check 复核。 */
export const GROK_POOL_TRUST_MS = 24 * 60 * 60 * 1000

/** 池子上限：只保留 RTT 最快的 N 个已验证节点，避免"验证通过"变成 129 个节点全量体检。 */
export const GROK_POOL_MAX_SIZE = 12

function proxyName(proxy: GrokProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

function dedupeByName(proxies: readonly GrokProxyRecord[]): GrokProxyRecord[] {
  const seen = new Set<string>()
  const unique: GrokProxyRecord[] = []
  for (const proxy of proxies) {
    const name = proxyName(proxy)
    if (!name || seen.has(name)) {
      continue
    }
    seen.add(name)
    unique.push(proxy)
  }
  return unique
}

/** 未验证节点的候选顺序：非香港优先（香港出口可能轮换到被挑战的 IP），保持原 provider 顺序。 */
export function orderGrokCandidates(
  proxies: readonly GrokProxyRecord[]
): GrokProxyRecord[] {
  const unique = dedupeByName(proxies)
  return [...unique].sort((a, b) => {
    const hkA = isHongKongNamed(a) ? 1 : 0
    const hkB = isHongKongNamed(b) ? 1 : 0
    return hkA - hkB
  })
}

function probeRtt(cache: GrokNodeProbeCache, proxy: GrokProxyRecord): number {
  const record = cache.get(computeProxyNodeFingerprint(proxy))
  return record?.alive ? record.rttMs : Number.POSITIVE_INFINITY
}

/** 香港命名的节点出口可能轮换到被 Cloudflare 挑战的 HK IP（实测同一节点时好时坏），排到最后只做兜底。 */
const HONG_KONG_NAME_PATTERN = /香港|\bHK\b|hong\s*kong|hongkong/i

function isHongKongNamed(proxy: GrokProxyRecord): boolean {
  return HONG_KONG_NAME_PATTERN.test(proxyName(proxy))
}

/**
 * 已验证节点按 RTT 升序；没有可用节点时返回全量节点（宁可用未验证的，也不能让 provider 变空）。
 * 只信任 {@link GROK_POOL_TRUST_MS} 内的存活样本，避免长期未运行时用一份全死的小池子卡住所有请求。
 * provider 的 health-check 仍会以 `expected-status: 200` 复核，未验证节点不会真正被选中。
 */
export function orderGrokProxies(
  proxies: readonly GrokProxyRecord[],
  probeCache?: GrokNodeProbeCache,
  nowMs: number = Date.now()
): GrokProxyRecord[] {
  const unique = dedupeByName(proxies)
  if (!probeCache || probeCache.size === 0) {
    return unique
  }

  const verified = unique.filter((proxy) => {
    const record = probeCache.get(computeProxyNodeFingerprint(proxy))
    return record?.alive === true && nowMs - record.checkedAt <= GROK_POOL_TRUST_MS
  })
  if (verified.length === 0) {
    return unique
  }

  return [...verified]
    .sort((a, b) => {
      const hkA = isHongKongNamed(a) ? 1 : 0
      const hkB = isHongKongNamed(b) ? 1 : 0
      if (hkA !== hkB) {
        return hkA - hkB
      }
      const rttA = probeRtt(probeCache, a)
      const rttB = probeRtt(probeCache, b)
      if (rttA !== rttB) {
        return rttA < rttB ? -1 : 1
      }
      return proxyName(a).localeCompare(proxyName(b), 'zh-CN')
    })
    .slice(0, GROK_POOL_MAX_SIZE)
}

/**
 * 代理页快照：把「节点名 → 最近一次真实请求结论」映射给 renderer。
 * 只映射当前订阅里仍存在的节点，避免把已删除节点的旧样本带到 UI。
 */
export function buildGrokProbeSnapshot(
  proxies: readonly GrokProxyRecord[],
  probeCache?: GrokNodeProbeCache
): GrokProbeSnapshot {
  const snapshot: GrokProbeSnapshot = {}
  for (const proxy of proxies) {
    const name = proxyName(proxy)
    const record = probeCache?.get(computeProxyNodeFingerprint(proxy))
    if (!name || !record) {
      continue
    }
    snapshot[name] = {
      rttMs: record.alive ? record.rttMs : 0,
      checkedAt: record.checkedAt,
      state: record.alive ? 'usable' : 'failed',
      ...(record.status !== undefined ? { status: record.status } : {}),
      ...(record.reason ? { reason: record.reason } : {})
    }
  }
  return snapshot
}

/**
 * 修复排序：窗口内试过的节点降级到最后，保证下一轮先试没试过的候选，
 * 防止超时节点反复占住扫描预算、把后面的线路饿死（与 agy 修复扫描同一策略）。
 */
export function orderGrokRepairCandidates(
  proxies: readonly GrokProxyRecord[],
  attempts: ReadonlyMap<string, number>,
  nowMs: number,
  windowMs: number
): GrokProxyRecord[] {
  const untried: GrokProxyRecord[] = []
  const recentlyTried: GrokProxyRecord[] = []
  for (const proxy of proxies) {
    const attemptedAt = attempts.get(computeProxyNodeFingerprint(proxy)) ?? 0
    if (attemptedAt > 0 && nowMs - attemptedAt < windowMs) {
      recentlyTried.push(proxy)
    } else {
      untried.push(proxy)
    }
  }
  return [...untried, ...recentlyTried]
}

export function buildSparkleGrokProviderDocument(input: {
  proxies: readonly GrokProxyRecord[]
  probeCache?: GrokNodeProbeCache
}): { proxies: GrokProxyRecord[] } {
  return {
    proxies: orderGrokProxies(input.proxies, input.probeCache)
  }
}

/** provider 成员集合是否变化；顺序变化不触发热重载，只有增删节点才需要让 mihomo 重读。 */
export function grokProviderMembershipChanged(
  previousNames: readonly string[],
  nextNames: readonly string[]
): boolean {
  const previous = new Set(previousNames)
  const next = new Set(nextNames)
  if (previous.size !== next.size) {
    return true
  }
  for (const name of next) {
    if (!previous.has(name)) {
      return true
    }
  }
  return false
}
