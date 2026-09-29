import {
  AUTO_SELECT_DELAY_TEST_URL,
  CURSOR_DEDICATED_GROUP_NAME,
  DEFAULT_GENERAL_DELAY_TEST_URL,
  isAutoSwitchingGroupType,
  isAutoSwitchingProxyName,
  isCursorDedicatedGroupName,
  isNestedAutoSwitchSelection,
  isSparkleAutoSelectSubGroup,
  isHongKongFilterGroupName,
  isSparkleRegionalAutoSelectGroup,
  prependCursorDedicatedDirectOption,
} from './cursorProxyGroup'
import {
  filterMarathonCursorEligibleVpsLeaves,
} from './marathonHy2OnlyCore'
import {
  buildRegionProviderFilter,
  DEFAULT_REGION_PRIORITY,
  nodeMatchesRegion,
  resolveEffectiveRegionPriority
} from './regionPriority'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import type { MihomoChangeProxyOptions } from './mihomoApi'
import {
  buildNonAnyTlsRegionalMembers,
  excludeAnyTlsFromAutoSelectUrlTestGroups,
  proxyCatalogHasTypes,
  type AutoSelectAnyTlsExclusionResult,
  type ProxyCatalogEntry,
} from './autoSelectAnyTlsExclusionCore'

export interface MihomoAutoSwitchApi {
  mihomoGroups: () => Promise<ControllerMixedGroup[]>
  mihomoChangeProxy: (
    group: string,
    proxy: string,
    options?: MihomoChangeProxyOptions
  ) => Promise<boolean>
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
  tolerance?: number
  timeout?: number
  'max-failed-times'?: number
  lazy?: boolean
}

export interface EnsureAutoSwitchOptions {
  leafProxyNames?: string[]
  leafProxyCatalog?: ProxyCatalogEntry[]
  regionPriority?: string[]
}

export const AUTO_SELECT_GROUP_NAME = '自动选择' as const

/** 自动选择 探测目标：用户主用 Gemini——探测即验证目标站可达。 */
export const AUTO_SELECT_GEMINI_PROBE_URL = 'https://gemini.google.com' as const
/** 全 HTTPS 握手探测的合理余量（2000 会误杀可用节点）。 */
export const AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS = 5000


/** `自动选择` 的 provider filter：只命中国家/地区节点（香港与占位节点不命中）。 */
export { buildAutoSelectCountryFilter } from './regionPriority'
const REGION_AUTO_SELECT_PREFIX = 'Sparkle-' as const

/** Subscription url-test auto-select — replaced by Sparkle {@link AUTO_SELECT_GROUP_NAME}. */
const LEGACY_SUBSCRIPTION_AUTO_SELECT_NAMES = ['♻️ 自动选择'] as const

function isLegacySubscriptionAutoSelectName(name: string): boolean {
  return (LEGACY_SUBSCRIPTION_AUTO_SELECT_NAMES as readonly string[]).includes(name)
}

function rewriteLegacySubscriptionAutoSelectRefs(proxies: string[]): string[] {
  const seen = new Set<string>()
  const rewritten: string[] = []
  for (const ref of proxies) {
    const target = isLegacySubscriptionAutoSelectName(ref) ? AUTO_SELECT_GROUP_NAME : ref
    if (!seen.has(target)) {
      seen.add(target)
      rewritten.push(target)
    }
  }
  return rewritten
}

function rewriteLegacySubscriptionAutoSelectInGroups(groups: ProxyGroupConfig[]): void {
  const withoutLegacy = groups.filter((group) => !isLegacySubscriptionAutoSelectName(group.name))
  groups.length = 0
  groups.push(...withoutLegacy)

  for (const group of groups) {
    if (group.proxies?.length) {
      group.proxies = rewriteLegacySubscriptionAutoSelectRefs(group.proxies)
    }
  }
}

function rewriteLegacyAutoSelectRuleTargets(profile: MihomoConfig): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return
  }

  profile.rules = rules.map((rule) => {
    let updated = rule
    for (const legacy of LEGACY_SUBSCRIPTION_AUTO_SELECT_NAMES) {
      if (updated.includes(legacy)) {
        updated = updated.replaceAll(legacy, AUTO_SELECT_GROUP_NAME)
      }
    }
    return updated
  }) as MihomoConfig['rules']
}

/** Sparkle 自动选择 + regional url-test sub-groups (+ subscription 故障转移 when present). */
function collectSparkleAutoSelectGroupRefs(groups: ProxyGroupConfig[]): string[] {
  const names = new Set(groups.map((group) => group.name))
  const refs: string[] = []

  if (names.has(AUTO_SELECT_GROUP_NAME)) {
    refs.push(AUTO_SELECT_GROUP_NAME)
  }

  for (const group of groups) {
    if (isSparkleRegionalAutoSelectGroup(group.name)) {
      refs.push(group.name)
    }
  }

  if (names.has('故障转移')) {
    refs.push('故障转移')
  }

  return refs
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
  leafProxyCatalog: ProxyCatalogEntry[] | undefined
): ProxyGroupConfig | null {
  // 地区组 = url-test：组内自动选延迟最低；当前节点失效才切换（tolerance 防抖）；
  // url-test 同样支持手动固定。
  const base = {
    type: 'url-test',
    url: DEFAULT_GENERAL_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL,
    tolerance: DEFAULT_URL_TEST_TOLERANCE_MS,
    timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
    lazy: true
  } as const
  if (profileId) {
    const filter = buildRegionProviderFilter(region)
    if (filter) {
      return {
        name: buildRegionalAutoSelectGroupName(region),
        ...base,
        use: [profileId],
        filter
      }
    }
  }

  if (leafProxyCatalog?.length && proxyCatalogHasTypes(leafProxyCatalog)) {
    const nonAnyTlsMembers = buildNonAnyTlsRegionalMembers(region, leafProxyCatalog)
    if (nonAnyTlsMembers.length === 0) {
      return null
    }
    return {
      name: buildRegionalAutoSelectGroupName(region),
      ...base,
      proxies: nonAnyTlsMembers,
    }
  }

  const members = (leafNames ?? []).filter((name) => nodeMatchesRegion(name, region))
  if (members.length > 0) {
    return {
      name: buildRegionalAutoSelectGroupName(region),
      ...base,
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
 * Rewrite 自动选择 as a fallback chain over regional url-test sub-groups (新加坡优先).
 * Each Sparkle-* regional group is a manual select over that region (AnyTLS excluded).
 */
function ensureRegionPriorityAutoSelect(
  groups: ProxyGroupConfig[],
  profileId: string | undefined,
  regionPriority: readonly string[],
  leafProxyNames: string[] | undefined,
  leafProxyCatalog: ProxyCatalogEntry[] | undefined
): void {
  const leafNames = resolveAutoSelectLeafNames(groups, leafProxyNames)

  const regionalGroups: ProxyGroupConfig[] = []
  const fallbackRefs: string[] = []

  for (const region of regionPriority) {
    const regional = buildRegionalUrlTestGroup(
      region,
      profileId,
      leafNames,
      leafProxyCatalog
    )
    if (regional) {
      regionalGroups.push(regional)
      fallbackRefs.push(regional.name)
    }
  }

  // Do not nest 🎯 Cursor 专用 inside 自动选择 — Cursor Dedicated already nests 自动选择
  // (切啥就走啥). Nesting both ways creates a select-group cycle.

  if (fallbackRefs.length === 0) {
    return
  }

  // 自动选择 = 原生 fallback（按顺序用第一个可用节点，当前失效才降级）：
  // - 探测目标 = Gemini：选中的链路就是实测能正常打开 Gemini 的
  // - interval 300：每 5 分钟检查一次；timeout 5000：全 HTTPS 握手余量
  // - 成员 = sparkle-fast（按地区优先级排序的扁平节点文件，见 sparkleFastProviderCore）
  const autoSelectGroup: ProxyGroupConfig = {
    name: AUTO_SELECT_GROUP_NAME,
    type: 'fallback',
    url: AUTO_SELECT_GEMINI_PROBE_URL,
    interval: DEFAULT_URL_TEST_INTERVAL,
    timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
    lazy: true,
  }
  if (profileId) {
    autoSelectGroup.use = [FAST_NODE_PROVIDER_ID]
  } else {
    autoSelectGroup.proxies = fallbackRefs
  }

  const withoutAutoSelect = groups.filter(
    (group) => group.name !== AUTO_SELECT_GROUP_NAME && !isSparkleAutoSelectSubGroup(group.name)
  )

  const autoSelectIndex = groups.findIndex((group) => group.name === AUTO_SELECT_GROUP_NAME)
  const insertAt = autoSelectIndex >= 0 ? autoSelectIndex : 0
  withoutAutoSelect.splice(insertAt, 0, ...regionalGroups, autoSelectGroup)

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
): AutoSelectAnyTlsExclusionResult {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  if (groups.length === 0) {
    return { groupsMutated: 0, proxiesRemoved: 0, removedLeaves: [], groupsRemoved: [] }
  }

  const regionPriority = resolveEffectiveRegionPriority(
    options.regionPriority ?? [...DEFAULT_REGION_PRIORITY]
  )

  ensureAutoSelectUrlTestGroup(groups, profileId)
  ensureRegionPriorityAutoSelect(
    groups,
    profileId,
    regionPriority,
    options.leafProxyNames,
    options.leafProxyCatalog,
  )
  rewriteLegacySubscriptionAutoSelectInGroups(groups)
  const anyTlsExclusion = excludeAnyTlsFromAutoSelectUrlTestGroups(
    groups,
    options.leafProxyCatalog ?? [],
  )
  profile['proxy-groups'] = groups as MihomoConfig['proxy-groups']
  rewriteLegacyAutoSelectRuleTargets(profile)

  const autoSwitchRefs = collectSparkleAutoSelectGroupRefs(groups)
  if (autoSwitchRefs.length === 0) {
    return anyTlsExclusion
  }

  for (const group of groups) {
    if (isCursorDedicatedGroupName(group.name)) {
      continue
    }
    if (group.name === AUTO_SELECT_GROUP_NAME || isAutoSwitchingProxyName(group.name)) {
      continue
    }
    // BUG-2026-09-15-009: Sparkle sub-groups (regional + cursor) are select groups too;
    // appending the auto-switch refs to them would create self-references.
    if (isSparkleAutoSelectSubGroup(group.name) || isHongKongFilterGroupName(group.name)) {
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
  return anyTlsExclusion
}

/** Cursor 专用组：DIRECT + VPS + 自动选择（可手动点选；程序不自动 change_proxy）。 */
export function appendRegionalAutoGroupsToCursorDedicated(
  profile: MihomoConfig,
  _regionPriority: readonly string[]
): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
  if (!cursorGroup) {
    return
  }

  const hasAutoSelect = groups.some((group) => group.name === AUTO_SELECT_GROUP_NAME)

  if (cursorGroup.use?.length) {
    cursorGroup.proxies = prependCursorDedicatedDirectOption(cursorGroup.proxies ?? [])
    if (hasAutoSelect) {
      cursorGroup.proxies = appendAutoSelectToCursorDedicated(cursorGroup.proxies)
    }
    return
  }

  const existing = cursorGroup.proxies ?? []
  const vpsLeaves = filterMarathonCursorEligibleVpsLeaves(
    existing.filter((ref) => /vps/i.test(ref)),
  )
  cursorGroup.proxies = prependCursorDedicatedDirectOption(vpsLeaves)
  if (hasAutoSelect) {
    cursorGroup.proxies = appendAutoSelectToCursorDedicated(cursorGroup.proxies)
  }
}

function appendAutoSelectToCursorDedicated(members: readonly string[]): string[] {
  const withoutAuto = members.filter((name) => name !== AUTO_SELECT_GROUP_NAME)
  return [...withoutAuto, AUTO_SELECT_GROUP_NAME]
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

export const DEFAULT_URL_TEST_INTERVAL = 300
/**
 * BUG-2026-09-15-007: hysteresis aligned to the operator rule "switch only when
 * the current node is >2000ms (or unavailable)". mihomo url-test only re-selects
 * when another node beats the current by more than this, so the absolute 2000ms
 * trigger stays owned by the native url-test group (timeout: 5000).
 */
export const DEFAULT_URL_TEST_TOLERANCE_MS = 2000

/** `自动选择` 判定"不可用"的探测超时：超过它才允许切换到下一个节点。 */
export const AUTO_SELECT_UNHEALTHY_TIMEOUT_MS = 2000


export function buildUrlTestGroupDefaults(): {
  type: 'url-test'
  url: string
  interval: number
  tolerance: number
  lazy: boolean
} {
  return {
    type: 'url-test',
    url: DEFAULT_GENERAL_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL,
    tolerance: DEFAULT_URL_TEST_TOLERANCE_MS,
    lazy: true
  }
}

/** Sparkle-* regional groups: only nodes that can reach ChatGPT are eligible. */
export function buildRegionalAutoSelectUrlTestDefaults(): {
  type: 'url-test'
  url: string
  interval: number
  tolerance: number
  lazy: boolean
} {
  return {
    type: 'url-test',
    url: AUTO_SELECT_DELAY_TEST_URL,
    interval: DEFAULT_URL_TEST_INTERVAL,
    tolerance: DEFAULT_URL_TEST_TOLERANCE_MS,
    lazy: true
  }
}

