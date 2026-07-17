import {
  AUTO_SELECT_DELAY_TEST_URL,
  CURSOR_DEDICATED_GROUP_NAME,
  DEFAULT_GENERAL_DELAY_TEST_URL,
  HONG_KONG_DELAY_TEST_URL,
  isAutoSwitchingGroupType,
  isAutoSwitchingProxyName,
  isCursorDedicatedGroupName,
  isNestedAutoSwitchSelection,
  isSparkleRegionalAutoSelectGroup
} from './cursorProxyGroup'
import {
  buildRegionProviderFilter,
  DEFAULT_REGION_PRIORITY,
  nodeMatchesRegion,
  resolveEffectiveRegionPriority
} from './regionPriority'
import type { MihomoChangeProxyOptions } from './mihomoApi'

export interface MihomoAutoSwitchApi {
  mihomoGroups: () => Promise<ControllerMixedGroup[]>
  mihomoChangeProxy: (
    group: string,
    proxy: string,
    options?: MihomoChangeProxyOptions
  ) => Promise<ControllerProxiesDetail | null>
  mihomoGroupDelay: (group: string, url?: string) => Promise<ControllerGroupDelay>
}

const PREFERRED_AUTO_SWITCH_NAMES = ['自动选择', '故障转移'] as const

interface ProxyGroupConfig {
  name: string
  type?: string
  proxies?: string[]
  use?: string[]
  filter?: string
  url?: string
  interval?: number
}

export interface EnsureAutoSwitchOptions {
  leafProxyNames?: string[]
  regionPriority?: string[]
}

const AUTO_SELECT_GROUP_NAME = '自动选择' as const
const REGION_AUTO_SELECT_PREFIX = 'Sparkle-自动-' as const

function collectSubscriptionAutoSwitchRefs(groups: ProxyGroupConfig[]): string[] {
  const names = new Set(groups.map((group) => group.name))
  return PREFERRED_AUTO_SWITCH_NAMES.filter((name) => names.has(name))
}

function appendAutoSwitchRefs(proxies: string[], refs: string[]): string[] {
  const merged = [...proxies]
  for (const ref of refs) {
    if (!merged.includes(ref)) {
      merged.push(ref)
    }
  }
  return merged
}

function buildRegionalAutoSelectGroupName(region: string): string {
  return `${REGION_AUTO_SELECT_PREFIX}${region}`
}

function buildRegionalUrlTestGroup(
  region: string,
  profileId: string | undefined,
  leafNames: string[] | undefined,
  defaults: ReturnType<typeof buildRegionalAutoSelectUrlTestDefaults>
): ProxyGroupConfig | null {
  if (profileId) {
    const filter = buildRegionProviderFilter(region)
    if (filter) {
      return {
        name: buildRegionalAutoSelectGroupName(region),
        ...defaults,
        use: [profileId],
        filter
      }
    }
  }

  const members = (leafNames ?? []).filter((name) => nodeMatchesRegion(name, region))
  if (members.length > 0) {
    return {
      name: buildRegionalAutoSelectGroupName(region),
      ...defaults,
      proxies: members
    }
  }

  return null
}

function resolveAutoSelectLeafNames(
  groups: ProxyGroupConfig[],
  leafProxyNames: string[] | undefined
): string[] | undefined {
  if (leafProxyNames?.length) {
    return leafProxyNames
  }

  const autoSelect = groups.find((group) => group.name === AUTO_SELECT_GROUP_NAME)
  return autoSelect?.proxies
}

/**
 * Rewrite 自动选择 as a fallback chain: SG → JP → TW → KR → US regional url-test sub-groups.
 * Within each region mihomo picks the lowest-delay node; fallback advances when a region is down.
 */
function ensureRegionPriorityAutoSelect(
  groups: ProxyGroupConfig[],
  profileId: string | undefined,
  regionPriority: readonly string[],
  leafProxyNames: string[] | undefined
): void {
  const defaults = buildRegionalAutoSelectUrlTestDefaults()
  const leafNames = resolveAutoSelectLeafNames(groups, leafProxyNames)

  const regionalGroups: ProxyGroupConfig[] = []
  const fallbackRefs: string[] = []

  for (const region of regionPriority) {
    const regional = buildRegionalUrlTestGroup(region, profileId, leafNames, defaults)
    if (regional) {
      regionalGroups.push(regional)
      fallbackRefs.push(regional.name)
    }
  }

  if (fallbackRefs.length === 0) {
    return
  }

  const fallbackGroup: ProxyGroupConfig = {
    name: AUTO_SELECT_GROUP_NAME,
    type: 'fallback',
    url: defaults.url,
    interval: defaults.interval,
    proxies: fallbackRefs
  }

  const withoutAutoSelect = groups.filter(
    (group) => group.name !== AUTO_SELECT_GROUP_NAME && !isSparkleRegionalAutoSelectGroup(group.name)
  )

  const autoSelectIndex = groups.findIndex((group) => group.name === AUTO_SELECT_GROUP_NAME)
  const insertAt = autoSelectIndex >= 0 ? autoSelectIndex : 0
  withoutAutoSelect.splice(insertAt, 0, ...regionalGroups, fallbackGroup)

  groups.length = 0
  groups.push(...withoutAutoSelect)
}

function ensureAutoSelectUrlTestGroup(
  groups: ProxyGroupConfig[],
  profileId: string | undefined
): void {
  const hasAutoSwitchGroup = groups.some((group) =>
    PREFERRED_AUTO_SWITCH_NAMES.includes(group.name as (typeof PREFERRED_AUTO_SWITCH_NAMES)[number])
  )
  if (hasAutoSwitchGroup) {
    return
  }

  const autoSelectGroup: ProxyGroupConfig = {
    name: AUTO_SELECT_GROUP_NAME,
    ...buildUrlTestGroupDefaults()
  }
  if (profileId) {
    autoSelectGroup.use = [profileId]
  }

  groups.unshift(autoSelectGroup)
}

/**
 * Expose auto-hop groups on non-Cursor Selector groups without changing subscription defaults.
 * Auto-switch refs are appended so the first proxy (e.g. DIRECT on 全球直连) stays the default.
 */
export function ensureSelectGroupsDefaultToAutoSwitch(
  profile: MihomoConfig,
  profileId?: string,
  options: EnsureAutoSwitchOptions = {}
): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  if (groups.length === 0) {
    return
  }

  const regionPriority = resolveEffectiveRegionPriority(
    options.regionPriority ?? [...DEFAULT_REGION_PRIORITY]
  )

  ensureAutoSelectUrlTestGroup(groups, profileId)
  ensureRegionPriorityAutoSelect(groups, profileId, regionPriority, options.leafProxyNames)
  profile['proxy-groups'] = groups as MihomoConfig['proxy-groups']

  const autoSwitchRefs = collectSubscriptionAutoSwitchRefs(groups)
  if (autoSwitchRefs.length === 0) {
    return
  }

  for (const group of groups) {
    if (isCursorDedicatedGroupName(group.name)) {
      continue
    }

    const type = (group.type ?? 'select').toLowerCase()
    if (type !== 'select') {
      continue
    }

    const existing = group.proxies ?? []
    group.proxies = appendAutoSwitchRefs(existing, autoSwitchRefs)
  }

  appendRegionalAutoGroupsToCursorDedicated(profile, regionPriority)
}

/** Allow Cursor dedicated Selector to hop through regional Sparkle url-test groups. */
export function appendRegionalAutoGroupsToCursorDedicated(
  profile: MihomoConfig,
  regionPriority: readonly string[]
): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
  if (!cursorGroup) {
    return
  }

  const regionalRefs = regionPriority
    .map((region) => buildRegionalAutoSelectGroupName(region))
    .filter((name) => groups.some((group) => group.name === name))

  if (regionalRefs.length === 0) {
    return
  }

  const existing = cursorGroup.proxies ?? []
  const merged = [
    ...regionalRefs,
    ...existing.filter((ref) => !regionalRefs.includes(ref) && !isSparkleRegionalAutoSelectGroup(ref))
  ]
  cursorGroup.proxies = merged
}

export function resolvePreferredAutoSwitchProxy(
  group: ControllerMixedGroup
): string | undefined {
  const available = new Set(group.all.map((proxy) => proxy.name))
  for (const name of PREFERRED_AUTO_SWITCH_NAMES) {
    if (available.has(name)) {
      return name
    }
  }

  for (const proxy of group.all) {
    if ('type' in proxy && isAutoSwitchingGroupType(proxy.type)) {
      return proxy.name
    }
  }

  return undefined
}

export function shouldApplyDefaultAutoSwitch(group: ControllerMixedGroup): boolean {
  if (isCursorDedicatedGroupName(group.name)) {
    return false
  }
  return group.type === 'Selector'
}

export function isGroupOnAutoSwitch(
  group: ControllerMixedGroup,
  groups: ControllerMixedGroup[]
): boolean {
  const current = group.now
  if (!current) {
    return false
  }
  if (isAutoSwitchingProxyName(current)) {
    return true
  }
  return isNestedAutoSwitchSelection(current, groups)
}

/** Intentionally disabled: group defaults must follow subscription / user selection. */
export async function applyDefaultAutoSwitchSelections(
  _api?: MihomoAutoSwitchApi
): Promise<number> {
  return 0
}

export const DEFAULT_URL_TEST_INTERVAL = 60

export function buildUrlTestGroupDefaults(): {
  type: 'url-test'
  url: string
  interval: number
} {
  return {
    type: 'url-test',
    url: DEFAULT_GENERAL_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL
  }
}

/** Sparkle-自动-* regional groups: only nodes that can reach ChatGPT are eligible. */
export function buildRegionalAutoSelectUrlTestDefaults(): {
  type: 'url-test'
  url: string
  interval: number
} {
  return {
    type: 'url-test',
    url: AUTO_SELECT_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL
  }
}

/** 🇭🇰 香港节点: only nodes that can reach Grok are eligible. */
export function buildHongKongUrlTestDefaults(): {
  type: 'url-test'
  url: string
  interval: number
} {
  return {
    type: 'url-test',
    url: HONG_KONG_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL
  }
}
