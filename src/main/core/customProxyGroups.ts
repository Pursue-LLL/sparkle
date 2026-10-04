import {
  CURSOR_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_DIRECT_PROXY,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  isAutoSwitchingGroupType,
  isCursorDedicatedGroupName,
  isCursorDedicatedGroupType,
  prependCursorDedicatedDirectOption,
  HONG_KONG_DELAY_TEST_URL
} from './cursorProxyGroup'
import {
  AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  AUTO_SELECT_GEMINI_PROBE_URL,
  DEFAULT_URL_TEST_INTERVAL
} from './defaultAutoSwitchProxy'
import {
  filterMarathonCursorEligibleVpsLeaves,
  MARATHON_CURSOR_VPS_PROVIDER_FILTER,
} from './marathonHy2OnlyCore'
import { resolveVpsProviderId } from './vpsProviderSplitCore'

/** Sparkle-injected HK filter group — members rebuilt on every generateProfile(). */
export const HONG_KONG_FILTER_GROUP_NAME = 'Sparkle-香港' as const

const SPARKLE_INJECTED_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  HONG_KONG_FILTER_GROUP_NAME
])

/** mihomo provider filter — Hong Kong leaf nodes (provider mode). */
const HONG_KONG_PROVIDER_FILTER = '香港|(?i)\\bHK\\b|hong\\s*kong|hongkong'

interface ProxyGroupConfig {
  name: string
  type?: string
  url?: string
  interval?: number
  tolerance?: number
  timeout?: number
  lazy?: boolean
  proxies?: string[]
  use?: string[]
  filter?: string
}

function matchesVpsNode(name: string): boolean {
  return /vps/i.test(name)
}

function matchesHongKongNode(name: string): boolean {
  return /香港|\bHK\b|hong\s*kong|hongkong/i.test(name)
}

const CURSOR_GROUP_REF_BLOCKLIST = new Set(['SDK DNS', 'GLOBAL', '🚀 节点选择', '自动选择', '故障转移'])
const AUTO_SELECT_GROUP_NAME = '自动选择' as const
const HONG_KONG_HOP_GROUP_NAMES = new Set(['🚀 节点选择', 'GLOBAL'])

const CURSOR_RULE_HOST_MARKERS = [
  'cursor.sh',
  'cursor.com',
  'cursorapi.com',
  'cursor-cdn.com',
  'cursorapi',
  'gcpp.cursor'
] as const

function isCursorDedicatedTrafficRule(parts: string[]): boolean {
  const ruleType = parts[0]
  const payload = parts[1]?.toLowerCase() ?? ''

  if (ruleType === 'DOMAIN') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(`.${marker}`) || payload.includes(marker)
    )
  }

  if (ruleType === 'DOMAIN-SUFFIX') {
    return CURSOR_RULE_HOST_MARKERS.some(
      (marker) => payload === marker || payload.endsWith(marker) || marker.endsWith(payload)
    )
  }

  if (ruleType === 'DOMAIN-KEYWORD') {
    return payload.includes('cursor')
  }

  return false
}

/** Rewrite rules still pointing at the pre-rename Cursor dedicated group. Returns true if any rule changed. */
export function migrateLegacyCursorDedicatedGroupReferences(profile: MihomoConfig): boolean {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return false
  }
  let migrated = false
  profile.rules = rules.map((rule) => {
    let nextRule = rule
    let ruleMigrated = false
    for (const legacyName of LEGACY_CURSOR_DEDICATED_GROUP_NAMES) {
      if (!nextRule.includes(legacyName)) {
        continue
      }
      ruleMigrated = true
      nextRule = nextRule.split(legacyName).join(CURSOR_DEDICATED_GROUP_NAME)
    }
    if (ruleMigrated) {
      migrated = true
    }
    return nextRule
  }) as MihomoConfig['rules']
  return migrated
}

/** Rewrite non-Cursor subscription rules that hijack general traffic into Cursor 专用. */
export function rewriteBroadCursorDedicatedRules(profile: MihomoConfig): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length) {
    return
  }

  profile.rules = rules.map((rule) => {
    const trimmed = rule.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return rule
    }
    const parts = trimmed.split(',').map((part) => part.trim())
    if (parts.length < 3) {
      return rule
    }
    const policy = parts[parts.length - 1]
    if (policy !== CURSOR_DEDICATED_GROUP_NAME) {
      return rule
    }
    if (isCursorDedicatedTrafficRule(parts)) {
      return rule
    }
    parts[parts.length - 1] = AUTO_SELECT_GROUP_NAME
    return parts.join(',')
  }) as MihomoConfig['rules']
}

function isRedundantHongKongWrapperGroup(group: ProxyGroupConfig): boolean {
  if (group.name === '香港专用') {
    return true
  }

  const proxies = group.proxies ?? []
  if (proxies.length === 0) {
    return false
  }

  const onlyRoutesToHongKong = proxies.every(
    (ref) => ref === HONG_KONG_FILTER_GROUP_NAME || HONG_KONG_HOP_GROUP_NAMES.has(ref)
  )
  return onlyRoutesToHongKong && /香港|\bHK\b|hong\s*kong|hongkong|专用/i.test(group.name)
}

function rewriteRulePolicyTargets(
  profile: MihomoConfig,
  fromTargets: Set<string>,
  toTarget: string
): void {
  const rules = profile.rules as string[] | undefined
  if (!rules?.length || fromTargets.size === 0) {
    return
  }

  profile.rules = rules.map((rule) => {
    const trimmed = rule.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return rule
    }

    const parts = trimmed.split(',')
    if (parts.length < 3) {
      return rule
    }

    const policyIndex = parts.length - 1
    const policy = parts[policyIndex].trim()
    if (!fromTargets.has(policy)) {
      return rule
    }

    parts[policyIndex] = toTarget
    return parts.join(',')
  }) as MihomoConfig['rules']
}

function dropRedundantHongKongWrapperGroups(
  groups: ProxyGroupConfig[],
  profile: MihomoConfig,
  hkGroupInjected: boolean
): ProxyGroupConfig[] {
  if (!hkGroupInjected) {
    return groups
  }

  const removedNames = new Set<string>()
  const kept = groups.filter((group) => {
    if (isRedundantHongKongWrapperGroup(group)) {
      removedNames.add(group.name)
      return false
    }
    return true
  })

  if (removedNames.size > 0) {
    rewriteRulePolicyTargets(profile, removedNames, HONG_KONG_FILTER_GROUP_NAME)
  }

  return kept
}

function collectCursorEligibleGroupNames(groups: ProxyGroupConfig[]): string[] {
  return groups
    .filter((group) => {
      if (CURSOR_GROUP_REF_BLOCKLIST.has(group.name)) {
        return false
      }
      if (group.name === 'GLOBAL' || SPARKLE_INJECTED_GROUP_NAMES.has(group.name)) {
        return false
      }
      if (isRedundantHongKongWrapperGroup(group)) {
        return false
      }
      const type = (group.type ?? 'select').toLowerCase()
      if (isAutoSwitchingGroupType(type)) {
        return false
      }
      return !['url-test', 'load-balance', 'fallback', 'relay'].includes(type)
    })
    .map((group) => group.name)
}

/**
 * Cursor 专用组 fallback 基座。Google AI API 按出口 IP 判地域：机场跳跃节点
 * 的落地 IP 池随 hop 漂移，会间歇踩中 geo 拒绝段（实测 400 FAILED_PRECONDITION，
 * BUG-2026-10-02-001）；VPS 池是固定物理出口（实测 200 零漂移）。fallback 钉住
 * 第一个健康成员（DIRECT→KR-VPS-Reality→KR-VPS-HY2），仅在探测失败时容灾切换。
 */
const CURSOR_GROUP_FALLBACK_BASE = {
  type: 'fallback',
  url: AUTO_SELECT_GEMINI_PROBE_URL,
  interval: DEFAULT_URL_TEST_INTERVAL,
  timeout: AUTO_SELECT_GEMINI_PROBE_TIMEOUT_MS,
  lazy: true
} as const

function buildCursorGroupConfig(
  leafNames: string[],
  _groupNames: string[],
  _groups: ProxyGroupConfig[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  const vpsNodes = filterMarathonCursorEligibleVpsLeaves(
    [...new Set(leafNames.filter(matchesVpsNode))],
  ).sort((a, b) => a.localeCompare(b, 'zh-CN'))

  if (profileId) {
    if (vpsNodes.length === 0) {
      return null
    }
    return {
      name: CURSOR_DEDICATED_GROUP_NAME,
      ...CURSOR_GROUP_FALLBACK_BASE,
      proxies: [CURSOR_DEDICATED_DIRECT_PROXY],
      use: [resolveVpsProviderId(profileId)],
      filter: MARATHON_CURSOR_VPS_PROVIDER_FILTER,
    }
  }

  if (vpsNodes.length === 0) {
    return null
  }
  return {
    name: CURSOR_DEDICATED_GROUP_NAME,
    ...CURSOR_GROUP_FALLBACK_BASE,
    proxies: prependCursorDedicatedDirectOption(vpsNodes),
  }
}

function buildHongKongGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  // 香港组按规则路由 x.com/Stripe 流量，必须自动挑"能开 Grok"的活节点——
  // select 组会永远钉在第一个成员（哪怕超时），因此这里必须是 url-test（支持手动固定）。
  if (profileId) {
    return {
      name: HONG_KONG_FILTER_GROUP_NAME,
      type: 'url-test',
      url: HONG_KONG_DELAY_TEST_URL,
      interval: 300,
      timeout: 5000,
      lazy: true,
      use: [profileId],
      filter: HONG_KONG_PROVIDER_FILTER
    }
  }

  const hkMembers = leafNames.filter(matchesHongKongNode)
  if (hkMembers.length === 0) {
    return null
  }
  return {
    name: HONG_KONG_FILTER_GROUP_NAME,
    type: 'select',
    proxies: hkMembers
  }
}

/**
 * Inject / refresh Sparkle-owned Selector groups. Subscription groups are kept as-is.
 * With proxy-provider profiles, leaf nodes are resolved via use+filter (not raw proxies names).
 */
export function ensureCustomProxyGroups(
  profile: MihomoConfig,
  leafProxyNames: string[],
  profileId?: string
): boolean {
  const existingGroups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  let subscriptionGroups = existingGroups.filter(
    (group) => !SPARKLE_INJECTED_GROUP_NAMES.has(group.name)
  )
  const subscriptionGroupNames = collectCursorEligibleGroupNames(existingGroups)

  const injected: ProxyGroupConfig[] = []
  const cursorGroup = buildCursorGroupConfig(
    leafProxyNames,
    subscriptionGroupNames,
    existingGroups,
    profileId
  )
  const hkGroup = buildHongKongGroupConfig(leafProxyNames, profileId)

  if (cursorGroup) {
    injected.push(cursorGroup)
  }
  if (hkGroup) {
    injected.push(hkGroup)
  }

  subscriptionGroups = dropRedundantHongKongWrapperGroups(
    subscriptionGroups,
    profile,
    hkGroup !== null
  )

  if (injected.length === 0) {
    profile['proxy-groups'] = subscriptionGroups as MihomoConfig['proxy-groups']
    const legacyGroupMigrated = migrateLegacyCursorDedicatedGroupReferences(profile)
    rewriteBroadCursorDedicatedRules(profile)
    return legacyGroupMigrated
  }

  profile['proxy-groups'] = [...injected, ...subscriptionGroups] as MihomoConfig['proxy-groups']
  const legacyGroupMigrated = migrateLegacyCursorDedicatedGroupReferences(profile)
  rewriteBroadCursorDedicatedRules(profile)
  return legacyGroupMigrated
}

export function isCursorDedicatedFailoverGroup(group: ControllerMixedGroup): boolean {
  return isCursorDedicatedGroupName(group.name) && isCursorDedicatedGroupType(group.type)
}

export function resolveCursorDedicatedGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  return groups.find((group) => isCursorDedicatedFailoverGroup(group))
}

/** Prefer Cursor dedicated; otherwise first manual Selector (failover when Cursor group is absent). */
export function resolveFailoverProxyGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  const cursorGroup = resolveCursorDedicatedGroup(groups)
  if (cursorGroup) {
    return cursorGroup
  }
  return groups.find(
    (group) =>
      group.type === 'Selector' &&
      group.name !== 'GLOBAL' &&
      group.name !== HONG_KONG_FILTER_GROUP_NAME
  )
}
