import { resolveGroupPolicy } from './autoSwitchPolicy'
import {
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  DEFAULT_GENERAL_DELAY_TEST_URL,
  GEMINI_REACHABILITY_PROBE_URL,
  isSparkleAutoSelectSubGroup,
  isSparkleRegionalAutoSelectGroup,
  filterCursorEligibleVpsLeaves,
  prependCursorDedicatedDirectOption
} from './cursorProxyGroup'
import { DEFAULT_REGION_PRIORITY, resolveEffectiveRegionPriority } from './regionPriority'
import type { MihomoChangeProxyOptions } from './mihomoApi'
import {
  excludeAnyTlsFromAutoSelectUrlTestGroups,
  type AutoSelectAnyTlsExclusionResult,
  type ProxyCatalogEntry
} from './autoSelectAnyTlsExclusionCore'
import { buildRegionalUrlTestGroup } from './regionalAutoSelectGroupsCore'
import { FAST_NODE_PROVIDER_ID, listFlatAutoSelectProxyNames } from './sparkleFastProviderCore'

export interface MihomoAutoSwitchApi {
  mihomoGroups: () => Promise<ControllerMixedGroup[]>
  mihomoChangeProxy: (
    group: string,
    proxy: string,
    options?: MihomoChangeProxyOptions
  ) => Promise<boolean>
  mihomoGroupDelay: (group: string, url?: string) => Promise<ControllerGroupDelay>
}

const PREFERRED_AUTO_SWITCH_NAMES = [AUTO_SELECT_GROUP_NAME, '故障转移'] as const

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
  'exclude-type'?: string
  'max-failed-times'?: number
  lazy?: boolean
}

export interface EnsureAutoSwitchOptions {
  leafProxyNames?: string[]
  leafProxyCatalog?: ProxyCatalogEntry[]
  regionPriority?: string[]
}

/** 自动选择 探测目标：用户主用 Gemini——探测即验证目标站可达（SSOT: cursorProxyGroup）。 */
export const AUTO_SELECT_GEMINI_PROBE_URL = GEMINI_REACHABILITY_PROBE_URL
/** 全 HTTPS 握手探测的合理余量（2000 会误杀可用节点）。 */
export const AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS = 5000

const DEFAULT_URL_TEST_INTERVAL = 300
/** url-test 仅在新节点比当前节点快出该值以上才切换，避免延迟抖动引起来回切。 */
const DEFAULT_URL_TEST_TOLERANCE_MS = 2000

/** 自动选择 与其地区组共用的探测口径：Gemini 可达性，每 5 分钟一次，5 秒超时。 */
const AUTO_SELECT_PROBE = {
  url: AUTO_SELECT_GEMINI_PROBE_URL,
  interval: DEFAULT_URL_TEST_INTERVAL,
  tolerance: DEFAULT_URL_TEST_TOLERANCE_MS,
  timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS
} as const

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
      updated = updated.replaceAll(legacy, AUTO_SELECT_GROUP_NAME)
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
 * Sparkle-* 地区组仅供用户在父组手动选路，组内节点仍由 url-test 自动选择/切换；
 * `自动选择` = 平铺节点 + fallback（按地区优先级用第一个可用节点，挂了才降级）。
 * 不把 🎯 Cursor 专用 嵌进 自动选择：Cursor 专用已包含 自动选择，反向嵌套会成环。
 */
function ensureRegionPriorityAutoSelect(
  groups: ProxyGroupConfig[],
  profileId: string | undefined,
  regionPriority: readonly string[],
  leafProxyNames: string[] | undefined,
  leafProxyCatalog: ProxyCatalogEntry[] | undefined
): void {
  const leafNames = resolveAutoSelectLeafNames(groups, leafProxyNames)
  const catalogProxies =
    leafProxyCatalog?.map((entry) => ({
      name: entry.name,
      type: entry.type
    })) ?? []
  const nameOnlyProxies = (leafNames ?? []).map((name) => ({ name }))

  const source = {
    profileId,
    leafNames,
    catalog: leafProxyCatalog
  }
  const regionalGroups = regionPriority.flatMap(
    (region) => buildRegionalUrlTestGroup(region, source, AUTO_SELECT_PROBE) ?? []
  )

  const autoSelectGroup: ProxyGroupConfig = {
    name: AUTO_SELECT_GROUP_NAME,
    type: 'fallback',
    url: AUTO_SELECT_PROBE.url,
    interval: AUTO_SELECT_PROBE.interval,
    timeout: AUTO_SELECT_PROBE.timeout,
    lazy: true
  }
  if (profileId) {
    autoSelectGroup.use = [FAST_NODE_PROVIDER_ID]
  } else {
    const flatNames = listFlatAutoSelectProxyNames(
      catalogProxies.length > 0 ? catalogProxies : nameOnlyProxies,
      [...regionPriority]
    )
    if (flatNames.length === 0 && regionalGroups.length === 0) {
      return
    }
    autoSelectGroup.proxies = flatNames
  }

  const withoutAutoSelect = groups.filter(
    (group) => group.name !== AUTO_SELECT_GROUP_NAME && !isSparkleAutoSelectSubGroup(group.name)
  )

  // 新的 自动选择 顶替旧的位置；订阅里原本没有它（只有 故障转移）时放到最前。
  const insertAt = Math.max(
    groups.findIndex((group) => group.name === AUTO_SELECT_GROUP_NAME),
    0
  )
  withoutAutoSelect.splice(insertAt, 0, ...regionalGroups, autoSelectGroup)

  groups.length = 0
  groups.push(...withoutAutoSelect)
}

/** 订阅里没有任何自动选路组时，先放一个默认 url-test，供后续步骤改建或兜底。 */
function ensureAutoSelectUrlTestGroup(groups: ProxyGroupConfig[]): void {
  const hasAutoSwitchGroup = groups.some((group) =>
    PREFERRED_AUTO_SWITCH_NAMES.includes(group.name as (typeof PREFERRED_AUTO_SWITCH_NAMES)[number])
  )
  if (hasAutoSwitchGroup) {
    return
  }

  groups.unshift({ name: AUTO_SELECT_GROUP_NAME, ...buildUrlTestGroupDefaults() })
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

  ensureAutoSelectUrlTestGroup(groups)
  ensureRegionPriorityAutoSelect(
    groups,
    profileId,
    regionPriority,
    options.leafProxyNames,
    options.leafProxyCatalog
  )
  rewriteLegacySubscriptionAutoSelectInGroups(groups)
  const anyTlsExclusion = excludeAnyTlsFromAutoSelectUrlTestGroups(
    groups,
    options.leafProxyCatalog ?? []
  )
  rewriteLegacyAutoSelectRuleTargets(profile)

  const autoSwitchRefs = collectSparkleAutoSelectGroupRefs(groups)
  for (const group of groups) {
    if (!resolveGroupPolicy(group).acceptsAutoSwitchRefs) {
      continue
    }
    group.proxies = appendAutoSwitchRefs(group.proxies ?? [], autoSwitchRefs)
  }

  appendRegionalAutoGroupsToCursorDedicated(profile)
  return anyTlsExclusion
}

/**
 * Cursor 专用组：DIRECT + 自建 VPS 节点 + 各地区 Sparkle 自动组（不含香港）+ 自动选择。
 * 可手动点选；程序不自动 change_proxy。重复调用结果不变。
 */
export function appendRegionalAutoGroupsToCursorDedicated(profile: MihomoConfig): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
  if (!cursorGroup) {
    return
  }

  // 地区组沿用 groups 中的顺序，即地区优先级顺序。
  const regionalRefs = groups
    .filter((group) => isSparkleRegionalAutoSelectGroup(group.name))
    .map((group) => group.name)
  const hasAutoSelect = groups.some((group) => group.name === AUTO_SELECT_GROUP_NAME)

  const existing = cursorGroup.proxies ?? []
  // provider 模式下 VPS 节点由 use 提供，proxies 里只会有 DIRECT；静态模式则只留合格的 VPS 叶子。
  const nodeMembers = cursorGroup.use?.length
    ? existing
    : filterCursorEligibleVpsLeaves(existing.filter((ref) => /vps/i.test(ref)))
  const regionalSet = new Set(regionalRefs)
  const baseMembers = prependCursorDedicatedDirectOption(nodeMembers).filter(
    (name) => name !== AUTO_SELECT_GROUP_NAME && !regionalSet.has(name)
  )

  cursorGroup.proxies = [
    ...baseMembers,
    ...regionalRefs,
    ...(hasAutoSelect ? [AUTO_SELECT_GROUP_NAME] : [])
  ]
}

function buildUrlTestGroupDefaults(): {
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
