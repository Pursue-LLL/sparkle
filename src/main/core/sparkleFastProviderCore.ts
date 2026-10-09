// [INPUT] 当前订阅节点 · 地区优先级
// [OUTPUT] FAST_NODE_PROVIDER_ID · orderProxiesByRegionPriority · buildSparkleFastProviderDocument
// [POS] `自动选择` 的专属 provider 文件：剔除 hy2/AnyTLS，按地区优先级平铺排序。
// mihomo 解析期不识别 provider 节点名，`自动选择` 通过 use 引用本文件；组类型为 url-test（节点挂了才换）。

import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'
import { AUTO_SELECT_EXCLUDED_NODE_TYPES } from './regionalAutoSelectGroupsCore'

export const FAST_NODE_PROVIDER_ID = 'sparkle-fast' as const
export const FAST_NODE_PROVIDER_FILENAME = 'sparkle-fast-proxies.yaml' as const

function isExcludedAutoSelectProxy(proxy: Record<string, unknown>): boolean {
  const type = String(proxy.type ?? '')
    .trim()
    .toLowerCase()
  return (AUTO_SELECT_EXCLUDED_NODE_TYPES as readonly string[]).includes(type)
}

function dropExcludedAutoSelectProxies(
  proxies: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return proxies.filter((proxy) => !isExcludedAutoSelectProxy(proxy))
}

/** 按地区优先级平铺排序；非优先国家节点排在尾部；香港排除；去重保序。 */
export function orderProxiesByRegionPriority(
  proxies: Array<Record<string, unknown>>,
  regionPriority: string[]
): Array<Record<string, unknown>> {
  const included = new Set<string>()
  const ordered: Array<Record<string, unknown>> = []
  for (const region of regionPriority) {
    for (const proxy of proxies) {
      const name = String(proxy.name ?? '').trim()
      if (!name || included.has(name)) {
        continue
      }
      if (isBlockedRegionNodeName(name)) {
        continue
      }
      if (nodeMatchesRegion(name, region)) {
        included.add(name)
        ordered.push(proxy)
      }
    }
  }
  for (const proxy of proxies) {
    const name = String(proxy.name ?? '').trim()
    if (!name || included.has(name)) {
      continue
    }
    if (isBlockedRegionNodeName(name)) {
      continue
    }
    included.add(name)
    ordered.push(proxy)
  }
  return ordered
}

export function buildSparkleFastProviderDocument(input: {
  proxies: Array<Record<string, unknown>>
  regionPriority: string[]
}): { proxies: Array<Record<string, unknown>> } {
  return {
    proxies: orderProxiesByRegionPriority(
      dropExcludedAutoSelectProxies(input.proxies),
      input.regionPriority
    )
  }
}

/** 无 provider 模式：`自动选择` 的平铺成员名（与 sparkle-fast 文件同序同过滤）。 */
export function listFlatAutoSelectProxyNames(
  proxies: Array<Record<string, unknown>>,
  regionPriority: string[]
): string[] {
  return buildSparkleFastProviderDocument({ proxies, regionPriority }).proxies.map((proxy) =>
    String(proxy.name ?? '').trim()
  ).filter(Boolean)
}
