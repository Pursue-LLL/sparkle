import {
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  isAutoSwitchingGroupType,
  isCursorDedicatedGroupName
} from './cursorProxyGroup'
import { resolveVpsProviderId } from './vpsProviderSplitCore'
import { buildHongKongUrlTestDefaults } from './defaultAutoSwitchProxy'

/** Sparkle-injected HK filter group — members rebuilt on every generateProfile(). */
export const HONG_KONG_FILTER_GROUP_NAME = '🇭🇰 香港节点' as const

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

function buildCursorGroupConfig(
  leafNames: string[],
  _groupNames: string[],
  _groups: ProxyGroupConfig[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  const vpsNodes = [...new Set(leafNames.filter(matchesVpsNode))].sort((a, b) =>
    a.localeCompare(b, 'zh-CN')
  )

  if (profileId) {
    if (vpsNodes.length === 0) {
      return null
    }
    return {
      name: CURSOR_DEDICATED_GROUP_NAME,
      type: 'select',
      use: [resolveVpsProviderId(profileId)]
    }
  }

  const members = [...vpsNodes]
  if (members.length === 0) {
    return null
  }
  return {
    name: CURSOR_DEDICATED_GROUP_NAME,
    type: 'select',
    proxies: members
  }
}

function buildHongKongGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  const urlTestDefaults = buildHongKongUrlTestDefaults()

  if (profileId) {
    return {
      name: HONG_KONG_FILTER_GROUP_NAME,
      ...urlTestDefaults,
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
    ...urlTestDefaults,
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
  return isCursorDedicatedGroupName(group.name) && group.type === 'Selector'
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
