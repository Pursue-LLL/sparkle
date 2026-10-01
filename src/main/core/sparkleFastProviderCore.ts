// [INPUT] 当前订阅节点 · 地区优先级
// [OUTPUT] FAST_NODE_PROVIDER_ID · orderProxiesByRegionPriority · buildSparkleFastProviderDocument
// [POS] `自动选择` 的专属 provider 文件：AnyTLS 剔除 + 按地区优先级排序的扁平节点列表。
// mihomo 配置解析期不识别 provider 节点名，因此 `自动选择` 只能通过 use 引用本文件；
// 每次配置生成时按优先级重写排序，切换行为全部交给 mihomo 原生 fallback。
// 纯函数模块（fs/路径由调用方持有），便于单测与避免 electron 运行时依赖。

import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'

export const FAST_NODE_PROVIDER_ID = 'sparkle-fast' as const
export const FAST_NODE_PROVIDER_FILENAME = 'sparkle-fast-proxies.yaml' as const

/**
 * AnyTLS 会重新引入 QUIC 静默卡死，故不进入自动选路的候选池。
 * 本文件是 `自动选择` 的唯一成员来源，在此剔除即等价于组级过滤，无需依赖 filter 正则。
 */
function isAnyTlsProxy(proxy: Record<string, unknown>): boolean {
  return String(proxy.type ?? '').trim().toLowerCase() === 'anytls'
}

function dropAnyTlsProxies(
  proxies: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return proxies.filter((proxy) => !isAnyTlsProxy(proxy))
}

/**
 * 按地区优先级排序的 provider 文件：优先地区节点在前（fallback 按顺序降级），
 * 非优先国家兜底在尾部；香港（屏蔽地区）排除；去重保序。
 */
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
    proxies: orderProxiesByRegionPriority(dropAnyTlsProxies(input.proxies), input.regionPriority),
  }
}
