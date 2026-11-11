import {
  AUTO_SELECT_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_DIRECT_PROXY,
  CURSOR_VPS_PROVIDER_FILTER,
  filterCursorEligibleVpsLeaves,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  isAutoSwitchingGroupType,
  isCursorDedicatedGroupName,
  prependCursorDedicatedDirectOption,
  AGY_DEDICATED_GROUP_NAME,
  HONG_KONG_DELAY_TEST_URL,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import { buildAgyGroupConfig } from './sparkleAgyProviderCore'
import { buildMailGroupConfig, buildMailProbeHiddenGroupConfig, ensureMailProbeListener } from './sparkleMailProviderCore'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import { resolveVpsProviderId } from './vpsProviderSplitCore'

/** Sparkle-injected HK filter group — members rebuilt on every generateProfile(). */
export const HONG_KONG_FILTER_GROUP_NAME = 'Sparkle-香港' as const

const SPARKLE_INJECTED_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  HONG_KONG_FILTER_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME,
  AGY_DEDICATED_GROUP_NAME
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
  hidden?: boolean
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

const CURSOR_GROUP_REF_BLOCKLIST = new Set([
  'SDK DNS',
  'GLOBAL',
  '🚀 节点选择',
  AUTO_SELECT_GROUP_NAME,
  '故障转移'
])
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
): ProxyGroupConfig {
  const vpsNodes = filterCursorEligibleVpsLeaves(
    [...new Set(leafNames.filter(matchesVpsNode))],
  ).sort((a, b) => a.localeCompare(b, 'zh-CN'))

  // 没有自建节点时组依然存在：成员由地区组 / 自动选择补齐，而不是整组消失导致规则悬空。
  if (profileId) {
    const group: ProxyGroupConfig = {
      name: CURSOR_DEDICATED_GROUP_NAME,
      type: 'select',
      proxies: [CURSOR_DEDICATED_DIRECT_PROXY],
    }
    if (vpsNodes.length > 0) {
      group.use = [resolveVpsProviderId(profileId)]
      group.filter = CURSOR_VPS_PROVIDER_FILTER
    }
    return group
  }

  return {
    name: CURSOR_DEDICATED_GROUP_NAME,
    type: 'select',
    proxies: prependCursorDedicatedDirectOption(vpsNodes),
  }
}

function buildHongKongGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  // 香港组按规则路由 x.com / Stripe 流量，必须自动挑延迟最低的活节点——
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
 * Grok 专用组：`select` + 应用层探针（sparkleGrokProbe）。
 * 不再用 url-test 全量排名——稳态只复核当前节点，失败才按池内顺序找下一个，找到即停。
 * 成员来自 `sparkle-grok` provider（只含实测 200 的节点，任意地区）。
 */
function buildGrokGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): ProxyGroupConfig | null {
  if (profileId) {
    return {
      name: GROK_DEDICATED_GROUP_NAME,
      type: 'select',
      use: [GROK_NODE_PROVIDER_ID]
    }
  }

  const members = [...new Set(leafNames)]
  if (members.length === 0) {
    return null
  }
  return {
    name: GROK_DEDICATED_GROUP_NAME,
    type: 'select',
    proxies: members
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

  const injected: ProxyGroupConfig[] = [
    buildCursorGroupConfig(leafProxyNames, subscriptionGroupNames, existingGroups, profileId)
  ]
  const hkGroup = buildHongKongGroupConfig(leafProxyNames, profileId)
  const grokGroup = buildGrokGroupConfig(leafProxyNames, profileId)
  const mailGroup = buildMailGroupConfig(leafProxyNames, profileId)
  const mailProbeGroup = buildMailProbeHiddenGroupConfig(profileId)
  const agyGroup = buildAgyGroupConfig(leafProxyNames, profileId)

  if (hkGroup) {
    injected.push(hkGroup)
  }
  if (grokGroup) {
    injected.push(grokGroup)
  }
  if (mailGroup) {
    injected.push(mailGroup)
  }
  if (mailProbeGroup) {
    injected.push(mailProbeGroup)
  }
  if (agyGroup) {
    injected.push(agyGroup)
  }
  ensureMailProbeListener(profile, profileId)

  subscriptionGroups = dropRedundantHongKongWrapperGroups(
    subscriptionGroups,
    profile,
    hkGroup !== null
  )

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
      group.name !== HONG_KONG_FILTER_GROUP_NAME &&
      group.name !== MAIL_DEDICATED_GROUP_NAME &&
      group.name !== AGY_DEDICATED_GROUP_NAME &&
      group.name !== MAIL_PROBE_HIDDEN_GROUP_NAME
  )
}
