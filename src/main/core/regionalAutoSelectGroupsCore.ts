// [INPUT] 地区 · provider id / 节点名 / 节点目录 · 探测参数
// [OUTPUT] AUTO_SELECT_EXCLUDED_NODE_TYPES · buildRegionalAutoSelectGroupName · buildRegionalUrlTestGroup
// [POS] `自动选择` 地区链的成员组：粘性 url-test（排除 hy2 / AnyTLS），没有可用节点的地区不建组。
// 纯函数模块，便于单测。

import { proxyCatalogHasTypes, type ProxyCatalogEntry } from './autoSelectAnyTlsExclusionCore'
import { REGION_AUTO_SELECT_PREFIX } from './cursorProxyGroup'
import { buildRegionProviderFilter, nodeMatchesRegion } from './regionPriority'

/**
 * 不进入自动选路的协议：
 * - AnyTLS：QUIC 长流会静默卡死；
 * - hysteria2：端口跳跃导致出口 IP 漂移（Google AI 接口会按 IP 段返回地域 400），
 *   且在网络劣化窗口里并不比 trojan 抗压。
 * 这些节点仍保留在手动选择组里。
 */
export const AUTO_SELECT_EXCLUDED_NODE_TYPES = ['hysteria2', 'anytls'] as const

export interface RegionalGroupProbe {
  url: string
  interval: number
  tolerance: number
  timeout: number
}

export interface RegionalGroupSource {
  profileId?: string
  leafNames?: string[]
  catalog?: ProxyCatalogEntry[]
}

export interface RegionalUrlTestGroup extends RegionalGroupProbe {
  name: string
  type: 'url-test'
  lazy: boolean
  use?: string[]
  filter?: string
  'exclude-type'?: string
  proxies?: string[]
}

export function buildRegionalAutoSelectGroupName(region: string): string {
  return `${REGION_AUTO_SELECT_PREFIX}${region}`
}

function isExcludedNodeType(type: string | undefined): boolean {
  return (AUTO_SELECT_EXCLUDED_NODE_TYPES as readonly string[]).includes(
    (type ?? '').trim().toLowerCase()
  )
}

/**
 * 地区内可进入自动选路的节点名；信息不足（既无带类型的目录也无节点名）返回 undefined。
 * 有节点目录时同时按协议过滤，仅有节点名时只能按地区过滤。
 */
function listEligibleMembers(region: string, source: RegionalGroupSource): string[] | undefined {
  const { catalog, leafNames } = source
  if (catalog?.length && proxyCatalogHasTypes(catalog)) {
    const members = catalog
      .filter((entry) => !isExcludedNodeType(entry.type) && nodeMatchesRegion(entry.name, region))
      .map((entry) => entry.name.trim())
    return [...new Set(members)]
  }
  return leafNames?.filter((name) => nodeMatchesRegion(name, region))
}

/**
 * 地区 url-test 组：组内选延迟最低的存活节点，当前节点没失效且没被新节点超出 tolerance 就不换。
 * 地区内没有可用节点时返回 null：mihomo 会把空组替换成直连型 COMPATIBLE，
 * 混进 fallback 链会让流量绕过代理。
 */
export function buildRegionalUrlTestGroup(
  region: string,
  source: RegionalGroupSource,
  probe: RegionalGroupProbe
): RegionalUrlTestGroup | null {
  const members = listEligibleMembers(region, source)
  if (members?.length === 0) {
    return null
  }

  const base = {
    name: buildRegionalAutoSelectGroupName(region),
    type: 'url-test',
    ...probe,
    lazy: true
  } as const

  if (source.profileId) {
    const filter = buildRegionProviderFilter(region)
    return filter
      ? {
          ...base,
          use: [source.profileId],
          filter,
          'exclude-type': AUTO_SELECT_EXCLUDED_NODE_TYPES.join('|')
        }
      : null
  }
  return members ? { ...base, proxies: members } : null
}
