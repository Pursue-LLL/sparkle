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
  groupsRemoved: string[]
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

/** Auto-hop groups whose member list must not include AnyTLS leaves. */
export function isAutoSelectLatencyGroupName(groupName: string, groupType?: string): boolean {
  const type = (groupType ?? '').trim().toLowerCase()
  if (type === 'url-test') {
    return isAutoSelectUrlTestGroupName(groupName, groupType)
  }
  if (type === 'fallback' && isAutoSwitchingProxyName(groupName)) {
    return true
  }
  return false
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

/** Augment a provider filter regex so named AnyTLS leaves are excluded (keeps `use` mode valid for `-t`). */
export function appendExcludeProxyNamesToProviderFilter(
  baseFilter: string,
  excludeNames: readonly string[],
): string {
  const escaped = excludeNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (escaped.length === 0) {
    return baseFilter.trim()
  }
  const excludePattern = escaped.join('|')
  const trimmedBase = baseFilter.trim()
  if (!trimmedBase) {
    return `(?!^(${excludePattern})$).+`
  }
  return `(?!^(${excludePattern})$)(?:${trimmedBase})`
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
    return { groupsMutated: 0, proxiesRemoved: 0, removedLeaves: [], groupsRemoved: [] }
  }

  const anyTlsNames = buildAnyTlsNameSet(catalog)
  if (anyTlsNames.size === 0) {
    return { groupsMutated: 0, proxiesRemoved: 0, removedLeaves: [], groupsRemoved: [] }
  }

  let groupsMutated = 0
  let proxiesRemoved = 0
  const removedLeaves = new Set<string>()
  const groupsRemoved: string[] = []

  for (const group of groups) {
    if (!isAutoSelectLatencyGroupName(group.name, group.type)) {
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
      if (kept.length === 0) {
        groupsRemoved.push(group.name.trim())
        continue
      }
      group.proxies = kept
      groupsMutated += 1
      continue
    }

    if (!group.use?.length) {
      continue
    }

    const region = resolveRegionFromSparkleAutoGroupName(group.name)
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

    if (dropped.length === 0) {
      continue
    }

    for (const leaf of dropped) {
      removedLeaves.add(leaf)
    }
    proxiesRemoved += dropped.length

    group.filter = appendExcludeProxyNamesToProviderFilter(group.filter ?? '.*', dropped)
    groupsMutated += 1
  }

  if (groupsRemoved.length > 0) {
    const removeSet = new Set(groupsRemoved)
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      if (removeSet.has(groups[index]?.name.trim() ?? '')) {
        groups.splice(index, 1)
      }
    }
    pruneAutoSelectRefsFromSelectGroups(groups, groupsRemoved)
  }

  return {
    groupsMutated,
    proxiesRemoved,
    removedLeaves: [...removedLeaves].sort(),
    groupsRemoved: [...groupsRemoved].sort(),
  }
}

function pruneAutoSelectRefsFromSelectGroups(
  groups: AutoSelectUrlTestGroup[],
  removedGroupNames: string[],
): void {
  const removeSet = new Set(removedGroupNames)
  for (const group of groups) {
    if ((group.type ?? 'select').toLowerCase() !== 'select' || !group.proxies?.length) {
      continue
    }
    group.proxies = group.proxies.filter((proxy) => !removeSet.has(proxy.trim()))
  }
}

export function formatAutoSelectAnyTlsExclusionLogLine(
  result: AutoSelectAnyTlsExclusionResult,
): string {
  return (
    `[AutoSelectAnyTlsExclusion]: outcome=${result.groupsMutated > 0 || result.groupsRemoved.length > 0 ? 'executed' : 'noop'}` +
    ` groups_mutated=${result.groupsMutated}` +
    ` groups_removed=${result.groupsRemoved.join(',') || 'none'}` +
    ` proxies_removed=${result.proxiesRemoved}` +
    ` removed_leaves=${result.removedLeaves.join(',') || 'none'}\n`
  )
}
