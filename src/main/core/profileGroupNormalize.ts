import { CURSOR_DEDICATED_GROUP_NAME, LEGACY_CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'

const SPARKLE_INJECTED_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAME,
  HONG_KONG_FILTER_GROUP_NAME
])

/** Template hop group names from global overrides tied to other subscriptions. */
const STALE_TEMPLATE_HOP_GROUP_NAMES = new Set<string>(['🚀 节点选择', '🌍 国外媒体'])

const RULE_BUILTIN_TARGETS = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'DNS', 'NOOP'])
const RULE_MODIFIERS = new Set(['no-resolve'])

export interface ProxyGroupConfig {
  name: string
  type?: string
  proxies?: string[]
  use?: string[]
}

export function collectSubscriptionGroupNames(profile: MihomoConfig): Set<string> {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  return new Set(
    groups
      .map((group) => group.name)
      .filter((name) => !SPARKLE_INJECTED_GROUP_NAMES.has(name) && name !== '香港专用')
  )
}

export function resolveSubscriptionMainSelectGroup(groups: ProxyGroupConfig[]): string | undefined {
  return groups.find(
    (group) =>
      (group.type ?? 'select').toLowerCase() === 'select' &&
      !SPARKLE_INJECTED_GROUP_NAMES.has(group.name)
  )?.name
}

function resolveMissingRuleTarget(
  missingName: string,
  groups: ProxyGroupConfig[],
  groupNames: Set<string>
): string | undefined {
  const mainSelectGroup = resolveSubscriptionMainSelectGroup(groups)
  if (!mainSelectGroup) {
    return undefined
  }

  if (STALE_TEMPLATE_HOP_GROUP_NAMES.has(missingName) && groupNames.has(CURSOR_DEDICATED_GROUP_NAME)) {
    return CURSOR_DEDICATED_GROUP_NAME
  }

  return mainSelectGroup
}

export function rewriteMissingRuleProxyGroupTargets(profile: MihomoConfig): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  const rules = profile.rules as string[] | undefined
  if (!groups.length || !rules?.length) {
    return
  }

  const groupNames = new Set(groups.map((group) => group.name))

  profile.rules = rules.map((rule) => {
    const trimmed = rule.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return rule
    }

    const parts = trimmed.split(',')
    while (parts.length > 0 && RULE_MODIFIERS.has(parts[parts.length - 1].trim())) {
      parts.pop()
    }
    if (parts.length < 3) {
      return rule
    }

    const policyIndex = parts.length - 1
    const policy = parts[policyIndex].trim()
    if (!policy || RULE_BUILTIN_TARGETS.has(policy) || groupNames.has(policy)) {
      return rule
    }

    const rewriteTarget = resolveMissingRuleTarget(policy, groups, groupNames)
    if (!rewriteTarget) {
      return rule
    }

    parts[policyIndex] = rewriteTarget
    return parts.join(',')
  }) as MihomoConfig['rules']
}

export function removeNonSubscriptionProxyGroups(
  profile: MihomoConfig,
  subscriptionGroupNames: ReadonlySet<string>
): void {
  const groups = profile['proxy-groups'] as ProxyGroupConfig[] | undefined
  if (!groups?.length) {
    return
  }

  profile['proxy-groups'] = groups.filter((group) => {
    if (SPARKLE_INJECTED_GROUP_NAMES.has(group.name)) {
      return true
    }
    return subscriptionGroupNames.has(group.name)
  }) as MihomoConfig['proxy-groups']
}
