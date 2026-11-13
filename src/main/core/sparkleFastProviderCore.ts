// [INPUT] 当前订阅节点 · 地区优先级 · 可选的节点延迟 ·
//         autoSelectAnyTlsExclusionCore::isAnyTlsProxyType (POS: url-test 自动组剔除 AnyTLS) ·
//         regionPriority::isBlockedRegionNodeName/nodeMatchesRegion (POS: 地区优先级与地区匹配)
// [OUTPUT] FAST_NODE_PROVIDER_ID · orderProxiesByRegionPriority · buildSparkleFastProviderDocument · listFlatAutoSelectProxyNames
// [POS] `自动选择` 的专属 provider 文件：按地区优先级分段，剔除 AnyTLS 与香港；
// 有实测延迟样本时，存活节点按地区分段 + 段内延迟升序排在前，无样本（超时/未测）节点按地区序统一垫在文件末尾（无延迟数据时保持订阅顺序）。
// mihomo 解析期不识别 provider 节点名，`自动选择` 通过 use 引用本文件；
// 组类型为 fallback：按此顺序用第一个可用节点，选定后由 autoSelectStickyPin 粘性固定，当前节点真挂掉才降级。
// 纯函数模块（fs/路径由调用方持有），便于单测。

import { isAnyTlsProxyType } from './autoSelectAnyTlsExclusionCore'
import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'

export const FAST_NODE_PROVIDER_ID = 'sparkle-fast' as const
export const FAST_NODE_PROVIDER_FILENAME = 'sparkle-fast-proxies.yaml' as const

type ProxyRecord = Record<string, unknown>

function proxyName(proxy: ProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

/** 节点名 → 最近一次探测延迟（毫秒）；缺失或不可用的节点不在表内。 */
export type NodeDelayMap = ReadonlyMap<string, number>

/**
 * 优先地区节点按优先级分段在前，其余国家节点垫底；去重保序；AnyTLS、香港与已确认 Gemini 锁区/送中节点不进入。
 * 有实测延迟样本时：所有有样本（探测存活）的节点按地区分段 + 段内延迟升序排在前面，
 * 无样本（探测超时/不可达）的节点按地区顺序统一垫在文件末尾，防止已知死节点挡在低优先地区的活节点前面。
 * 极端兜底：若排除 `blockedNodeNames` 后候选池为空，则回退保留原候选池，防止空 provider 让整组退化为 COMPATIBLE 直连。
 */
export function orderProxiesByRegionPriority(
  proxies: ProxyRecord[],
  regionPriority: string[],
  delayMs?: NodeDelayMap,
  blockedNodeNames?: ReadonlySet<string>
): ProxyRecord[] {
  const buildOrdered = (excludeNames?: ReadonlySet<string>): ProxyRecord[] => {
    const included = new Set<string>()
    const ordered: ProxyRecord[] = []
    const trailingUnsampled: ProxyRecord[] = []
    const hasSamples = Boolean(delayMs && delayMs.size > 0)
    const delayOf = (proxy: ProxyRecord): number =>
      delayMs?.get(proxyName(proxy)) ?? Number.POSITIVE_INFINITY
    const take = (matches: (name: string) => boolean): void => {
      const segment: ProxyRecord[] = []
      for (const proxy of proxies) {
        const name = proxyName(proxy)
        if (
          !name ||
          included.has(name) ||
          isAnyTlsProxyType(String(proxy.type ?? '')) ||
          isBlockedRegionNodeName(name) ||
          excludeNames?.has(name) ||
          !matches(name)
        ) {
          continue
        }
        included.add(name)
        segment.push(proxy)
      }
      if (!hasSamples) {
        ordered.push(...segment)
        return
      }
      const sampled = segment.filter((proxy) => delayMs?.has(proxyName(proxy)))
      const unsampled = segment.filter((proxy) => !delayMs?.has(proxyName(proxy)))
      sampled.sort((a, b) => {
        const da = delayOf(a)
        const db = delayOf(b)
        return da === db ? 0 : da < db ? -1 : 1
      })
      ordered.push(...sampled)
      trailingUnsampled.push(...unsampled)
    }
    for (const region of regionPriority) {
      take((name) => nodeMatchesRegion(name, region))
    }
    take(() => true)
    return [...ordered, ...trailingUnsampled]
  }

  if (blockedNodeNames && blockedNodeNames.size > 0) {
    const filtered = buildOrdered(blockedNodeNames)
    if (filtered.length > 0) {
      return filtered
    }
  }
  return buildOrdered()
}

export function buildSparkleFastProviderDocument(input: {
  proxies: ProxyRecord[]
  regionPriority: string[]
  delayMs?: NodeDelayMap
  blockedNodeNames?: ReadonlySet<string>
}): { proxies: ProxyRecord[] } {
  return {
    proxies: orderProxiesByRegionPriority(
      input.proxies,
      input.regionPriority,
      input.delayMs,
      input.blockedNodeNames
    )
  }
}

/** 无 provider 模式：`自动选择` 的平铺成员名（与 sparkle-fast 文件同序）。 */
export function listFlatAutoSelectProxyNames(
  proxies: ProxyRecord[],
  regionPriority: string[]
): string[] {
  return orderProxiesByRegionPriority(proxies, regionPriority).map(proxyName)
}
