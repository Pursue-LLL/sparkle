// [INPUT] 当前订阅节点 · 地区优先级
// [OUTPUT] FAST_NODE_PROVIDER_ID · orderProxiesByRegionPriority · buildSparkleFastProviderDocument · listFlatAutoSelectProxyNames
// [POS] `自动选择` 的专属 provider 文件：按地区优先级平铺排序，剔除 AnyTLS 与香港。
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

/** 优先地区节点按优先级在前，其余国家节点垫底；去重保序；AnyTLS 与香港不进入。 */
export function orderProxiesByRegionPriority(
  proxies: ProxyRecord[],
  regionPriority: string[]
): ProxyRecord[] {
  const included = new Set<string>()
  const ordered: ProxyRecord[] = []
  const take = (matches: (name: string) => boolean): void => {
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
      ordered.push(proxy)
    }
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
}): { proxies: ProxyRecord[] } {
  return { proxies: orderProxiesByRegionPriority(input.proxies, input.regionPriority) }
}

/** 无 provider 模式：`自动选择` 的平铺成员名（与 sparkle-fast 文件同序）。 */
export function listFlatAutoSelectProxyNames(
  proxies: ProxyRecord[],
  regionPriority: string[]
): string[] {
  return orderProxiesByRegionPriority(proxies, regionPriority).map(proxyName)
}
