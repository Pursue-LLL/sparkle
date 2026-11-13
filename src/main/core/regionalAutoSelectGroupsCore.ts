// [INPUT] 地区 · provider id / 节点名 / 节点目录 · 探测参数
// [OUTPUT] ProxyCatalogEntry · buildRegionalAutoSelectGroupName · buildRegionalUrlTestGroup
// [POS] `Sparkle-<地区>` 供用户在父组手动选择的地区组（url-test，组内自动切换）；没有可用节点的地区不建组。
// 不被 `自动选择` 引用。纯函数模块，便于单测。

import { REGION_AUTO_SELECT_PREFIX } from './cursorProxyGroup'
import { buildRegionProviderFilter, nodeMatchesRegion } from './regionPriority'

/** 节点目录条目：节点名与协议类型（类型仅透传，成员筛选只看地区）。 */
export interface ProxyCatalogEntry {
  name: string
  type?: string
}

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
  proxies?: string[]
}

export function buildRegionalAutoSelectGroupName(region: string): string {
  return `${REGION_AUTO_SELECT_PREFIX}${region}`
}

/**
 * 地区内可用节点名；信息不足（既无节点目录也无节点名）返回 undefined。
 * 有节点目录时按地区取目录节点名，否则按地区取节点名。
 */
function listEligibleMembers(region: string, source: RegionalGroupSource): string[] | undefined {
  const { catalog, leafNames } = source
  if (catalog?.length) {
    const members = catalog
      .filter((entry) => nodeMatchesRegion(entry.name, region))
      .map((entry) => entry.name.trim())
    return [...new Set(members)]
  }
  return leafNames?.filter((name) => nodeMatchesRegion(name, region))
}

/**
 * 地区 url-test 组。地区内没有可用节点时返回 null：
 * mihomo 会把空组替换成直连型 COMPATIBLE，留在组列表里会让手动选它的流量绕过代理。
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
    return filter ? { ...base, use: [source.profileId], filter } : null
  }
  return members ? { ...base, proxies: members } : null
}
