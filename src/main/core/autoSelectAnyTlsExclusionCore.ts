// [INPUT] Mihomo proxy catalog (name+type) · url-test auto-select groups
// [OUTPUT] excludeAnyTlsFromAutoSelectUrlTestGroups · buildNonAnyTlsRegionalMembers
// [POS] Auto-select url-test must skip AnyTLS (SSE/long-stream); manual select keeps all leaves.

import {
  isAutoSwitchingProxyName,
  isHongKongFilterGroupName,
  isSparkleAutoSelectSubGroup,
} from './cursorProxyGroup'
import { nodeMatchesRegion } from './regionPriority'

export interface ProxyCatalogEntry {
  name: string
  type?: string
}

export interface AutoSelectUrlTestGroup {
  name: string
  type?: string
  proxies?: string[]
  use?: string[]
  filter?: string
}

export interface AutoSelectAnyTlsExclusionResult {
  groupsMutated: number
  proxiesRemoved: number
  removedLeaves: string[]
}

const LEGACY_SUBSCRIPTION_AUTO_SELECT_NAMES = ['♻️ 自动选择'] as const

export function isAnyTlsProxyType(proxyType: string | undefined): boolean {
  return (proxyType ?? '').trim().toLowerCase() === 'anytls'
}

export function isAnyTlsProxyEntry(entry: ProxyCatalogEntry): boolean {
  return isAnyTlsProxyType(entry.type)
}

function buildAnyTlsNameSet(catalog: ProxyCatalogEntry[]): Set<string> {
  const names = new Set<string>()
  for (const entry of catalog) {
    if (isAnyTlsProxyEntry(entry)) {
      names.add(entry.name.trim())
    }
  }
  return names
}

function catalogHasTypedEntries(catalog: ProxyCatalogEntry[]): boolean {
  return catalog.some((entry) => typeof entry.type === 'string' && entry.type.trim().length > 0)
}

export function proxyCatalogHasTypes(catalog: ProxyCatalogEntry[]): boolean {
  return catalogHasTypedEntries(catalog)
}

/** Url-test groups whose latency winner must not be AnyTLS. */
export function isAutoSelectUrlTestGroupName(groupName: string, groupType?: string): boolean {
  const type = (groupType ?? '').trim().toLowerCase()
  if (type !== 'url-test') {
    return false
  }
  if (isSparkleAutoSelectSubGroup(groupName)) {
    return true
  }
  if (isAutoSwitchingProxyName(groupName)) {
    return true
  }
  if (isHongKongFilterGroupName(groupName)) {
    return true
  }
  return (LEGACY_SUBSCRIPTION_AUTO_SELECT_NAMES as readonly string[]).includes(groupName)
}

export function buildNonAnyTlsRegionalMembers(
  region: string,
  catalog: ProxyCatalogEntry[],
): string[] {
  const seen = new Set<string>()
  const members: string[] = []
  for (const entry of catalog) {
    const name = entry.name.trim()
    if (!name || isAnyTlsProxyEntry(entry) || !nodeMatchesRegion(name, region)) {
      continue
    }
    if (!seen.has(name)) {
      seen.add(name)
      members.push(name)
    }
  }
  return members
}

function resolveRegionFromSparkleAutoGroupName(groupName: string): string | undefined {
  const prefix = 'Sparkle-自动-'
  if (!groupName.startsWith(prefix)) {
    return undefined
  }
  const region = groupName.slice(prefix.length).trim()
  return region.length > 0 ? region : undefined
}

function filterProxyNamesExcludingAnyTls(
  proxyNames: string[],
  anyTlsNames: Set<string>,
): { kept: string[]; removed: string[] } {
  const kept: string[] = []
  const removed: string[] = []
  for (const proxy of proxyNames) {
    const trimmed = proxy.trim()
    if (anyTlsNames.has(trimmed)) {
      removed.push(trimmed)
      continue
    }
    kept.push(proxy)
  }
  return { kept, removed }
}

/**
 * Remove AnyTLS leaves from url-test auto-select groups only.
 * Select groups (🤖 AI / 🚀 节点选择) keep full membership for manual switching.
 */
export function excludeAnyTlsFromAutoSelectUrlTestGroups(
  groups: AutoSelectUrlTestGroup[],
  catalog: ProxyCatalogEntry[],
): AutoSelectAnyTlsExclusionResult {
  if (!catalogHasTypedEntries(catalog)) {
    return { groupsMutated: 0, proxiesRemoved: 0, removedLeaves: [] }
  }

  const anyTlsNames = buildAnyTlsNameSet(catalog)
  if (anyTlsNames.size === 0) {
    return { groupsMutated: 0, proxiesRemoved: 0, removedLeaves: [] }
  }

  let groupsMutated = 0
  let proxiesRemoved = 0
  const removedLeaves = new Set<string>()

  for (const group of groups) {
    if (!isAutoSelectUrlTestGroupName(group.name, group.type)) {
      continue
    }

    if (group.proxies?.length) {
      const { kept, removed } = filterProxyNamesExcludingAnyTls(group.proxies, anyTlsNames)
      if (removed.length === 0) {
        continue
      }
      for (const leaf of removed) {
        removedLeaves.add(leaf)
      }
      proxiesRemoved += removed.length
      group.proxies = kept
      groupsMutated += 1
      continue
    }

    if (!group.use?.length) {
      continue
    }

    const region = resolveRegionFromSparkleAutoGroupName(group.name)
    const materialized =
      region !== undefined
        ? buildNonAnyTlsRegionalMembers(region, catalog)
        : catalog.filter((entry) => !isAnyTlsProxyEntry(entry)).map((entry) => entry.name.trim())

    if (materialized.length === 0) {
      continue
    }

    const dropped = catalog
      .filter((entry) => {
        const name = entry.name.trim()
        if (!isAnyTlsProxyEntry(entry)) {
          return false
        }
        if (region !== undefined) {
          return nodeMatchesRegion(name, region)
        }
        return true
      })
      .map((entry) => entry.name.trim())

    for (const leaf of dropped) {
      removedLeaves.add(leaf)
    }
    proxiesRemoved += dropped.length

    group.proxies = materialized
    delete group.use
    delete group.filter
    groupsMutated += 1
  }

  return {
    groupsMutated,
    proxiesRemoved,
    removedLeaves: [...removedLeaves].sort(),
  }
}

export function formatAutoSelectAnyTlsExclusionLogLine(
  result: AutoSelectAnyTlsExclusionResult,
): string {
  return (
    `[AutoSelectAnyTlsExclusion]: outcome=${result.groupsMutated > 0 ? 'executed' : 'noop'}` +
    ` groups_mutated=${result.groupsMutated}` +
    ` proxies_removed=${result.proxiesRemoved}` +
    ` removed_leaves=${result.removedLeaves.join(',') || 'none'}\n`
  )
}
