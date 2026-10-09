// [INPUT] 当前订阅节点 · 地区优先级 · 可选的节点延迟
// [OUTPUT] FAST_NODE_PROVIDER_ID · orderProxiesByRegionPriority · buildSparkleFastProviderDocument · listFlatAutoSelectProxyNames
// [POS] `自动选择` 的专属 provider 文件：地区优先级分段，段内按延迟升序（无延迟数据则保持订阅顺序），剔除 AnyTLS 与香港。
// mihomo 解析期不识别 provider 节点名，`自动选择` 通过 use 引用本文件；
// 组类型为 fallback：按此顺序用第一个可用节点，当前节点挂了才降级。
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
 * 优先地区节点按优先级分段在前，其余国家节点垫底；去重保序；AnyTLS 与香港不进入。
 * 段内按延迟升序（Array.sort 稳定：无延迟的节点垫在段尾并保持订阅顺序）。
 */
export function orderProxiesByRegionPriority(
  proxies: ProxyRecord[],
  regionPriority: string[],
  delayMs?: NodeDelayMap
): ProxyRecord[] {
  const included = new Set<string>()
  const ordered: ProxyRecord[] = []
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
        !matches(name)
      ) {
        continue
      }
      included.add(name)
      segment.push(proxy)
    }
    if (delayMs) {
      // 两端同为 Infinity 时相减得 NaN，须显式比较以保持稳定序。
      segment.sort((a, b) => {
        const da = delayOf(a)
        const db = delayOf(b)
        return da === db ? 0 : da < db ? -1 : 1
      })
    }
    ordered.push(...segment)
  }
  for (const region of regionPriority) {
    take((name) => nodeMatchesRegion(name, region))
  }
  take(() => true)
  return ordered
}

export function buildSparkleFastProviderDocument(input: {
  proxies: ProxyRecord[]
  regionPriority: string[]
  delayMs?: NodeDelayMap
}): { proxies: ProxyRecord[] } {
  return {
    proxies: orderProxiesByRegionPriority(input.proxies, input.regionPriority, input.delayMs)
  }
}

/** 无 provider 模式：`自动选择` 的平铺成员名（与 sparkle-fast 文件同序）。 */
export function listFlatAutoSelectProxyNames(
  proxies: ProxyRecord[],
  regionPriority: string[]
): string[] {
  return orderProxiesByRegionPriority(proxies, regionPriority).map(proxyName)
}
