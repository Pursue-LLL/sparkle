// [INPUT] 节点指纹 · 被拒记忆（节点指纹 → 最近一次被判定出口不可用的时间）· 探测缓存 ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyProviderCore::AgyNodeProbeCache/AgyProxyRecord (POS: agy provider 与分组配置)
// [OUTPUT] AGY_FLAG_MEMORY_MS · AgyFlags · flagAgyNode · agyAvoidedAt · partitionByReputation
// [POS] agy 节点的被拒记忆（纯函数，无 I/O）：Google 对出口地区的判定是时变的，抖动节点能随机通过一次探测，
// 只看「最近一次探测的结论」会反复把同一个坏节点选回来。被判定出口不可用的节点在 24 小时内排到候选的最后，
// 一次通过的探测不会抹掉这条记忆；它只影响排序与严格模式下的候选资格，从不禁止节点（全灭时仍可作为最后手段）。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { AgyNodeProbeCache, AgyProxyRecord } from './sparkleAgyProviderCore'

/** 被拒记忆的保留时长：长于一次地区封控的典型时变窗口，又不会让节点被永久放逐。 */
export const AGY_FLAG_MEMORY_MS = 24 * 60 * 60 * 1000

/** 节点指纹 → 最近一次被判定出口不可用的时间。 */
export type AgyFlags = Map<string, number>

/** 记下一次「出口被拒」的判定：探测 400、生产日志里的地区拒绝、拨号失败风暴。 */
export function flagAgyNode(flags: AgyFlags, fingerprint: string, nowMs: number): void {
  flags.set(fingerprint, nowMs)
}

/**
 * 节点最近一次被判定不可用的时间；没有需要回避的记录返回 undefined。
 * 两个来源取较近者：被拒记忆（24 小时内），以及探测缓存里仍有效的「不可用」结论
 * （缓存条目的有效期由 sparkleAgyProbeCache 决定，这里只认 `usable === false`）。
 */
export function agyAvoidedAt(
  fingerprint: string,
  probeCache: AgyNodeProbeCache | undefined,
  flags: ReadonlyMap<string, number> | undefined,
  nowMs: number
): number | undefined {
  const flaggedAt = flags?.get(fingerprint)
  const flagged =
    flaggedAt !== undefined && nowMs - flaggedAt < AGY_FLAG_MEMORY_MS ? flaggedAt : undefined
  const record = probeCache?.get(fingerprint)
  const rejected = record?.usable === false ? record.checkedAt : undefined
  if (flagged === undefined || rejected === undefined) {
    return flagged ?? rejected
  }
  return Math.max(flagged, rejected)
}

/**
 * 按声誉分成两组：`clean` 保持原顺序；`avoided` 是需要回避的节点，最久远被拒的在前
 * （距今越久越可能已经恢复），同一时刻被拒的保持原顺序。
 */
export function partitionByReputation(
  proxies: readonly AgyProxyRecord[],
  probeCache: AgyNodeProbeCache | undefined,
  flags: ReadonlyMap<string, number> | undefined,
  nowMs: number
): { clean: AgyProxyRecord[]; avoided: AgyProxyRecord[] } {
  const clean: AgyProxyRecord[] = []
  const avoided: Array<{ proxy: AgyProxyRecord; avoidedAt: number }> = []
  for (const proxy of proxies) {
    const avoidedAt = agyAvoidedAt(computeProxyNodeFingerprint(proxy), probeCache, flags, nowMs)
    if (avoidedAt === undefined) {
      clean.push(proxy)
    } else {
      avoided.push({ proxy, avoidedAt })
    }
  }
  avoided.sort((a, b) => a.avoidedAt - b.avoidedAt)
  return { clean, avoided: avoided.map(({ proxy }) => proxy) }
}
