// [INPUT] cursorProxyGroup::AGY_DEDICATED_GROUP_NAME/CURSOR_DEDICATED_GROUP_NAME/AUTO_SELECT_GROUP_NAME/GENERAL_PROXY_GROUP_NAME… (POS: Sparkle 分组名常量与判定谓词) ·
//         customProxyGroups::HONG_KONG_FILTER_GROUP_NAME (POS: Sparkle 自有分组注入) ·
//         ruleSyntax::RULE_BUILTIN_TARGETS/rewriteRulePolicies (POS: 规则文本解析与策略改写)
// [OUTPUT] ProxyGroupConfig · collectSubscriptionGroupNames · resolveSubscriptionMainSelectGroup · rewriteMissingRuleProxyGroupTargets · removeNonSubscriptionProxyGroups · ensureMatchFallbackRule · dropUnknownGroupMembers
// [POS] 订阅分组归一：识别订阅主选择组，修复指向不存在分组的规则目标与兜底 `MATCH`（内置出口、订阅组与顶层内联节点为合法目标），清掉非订阅残留分组与失效成员。规则文本经 `ruleSyntax` 读取。

import {
  AGY_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_GROUP_NAME,
  AUTO_SELECT_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  GENERAL_PROXY_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'
import { RULE_BUILTIN_TARGETS, rewriteRulePolicies } from './ruleSyntax'

const SPARKLE_INJECTED_GROUP_NAMES = new Set<string>([
  CURSOR_DEDICATED_GROUP_NAME,
  ...LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  HONG_KONG_FILTER_GROUP_NAME,
  GROK_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME,
  AGY_DEDICATED_GROUP_NAME
])

/** Template hop group names from global overrides tied to other subscriptions. */
const STALE_TEMPLATE_HOP_GROUP_NAMES = new Set<string>(['🚀 节点选择', '🌍 国外媒体'])

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
  isCatchAll: boolean,
  groups: ProxyGroupConfig[],
  groupNames: ReadonlySet<string>
): string | undefined {
  // 兜底规则不能进 Cursor 专用组：它默认选中 DIRECT，等于让所有未命中的流量绕过代理
  if (
    !isCatchAll &&
    STALE_TEMPLATE_HOP_GROUP_NAMES.has(missingName) &&
    groupNames.has(CURSOR_DEDICATED_GROUP_NAME)
  ) {
    return CURSOR_DEDICATED_GROUP_NAME
  }

  return resolveSubscriptionMainSelectGroup(groups)
}

/** mihomo 只认顶层 `proxies` 里的节点为规则目标，provider 里的节点不算。 */
function collectInlineProxyNames(profile: MihomoConfig): string[] {
  const proxies = profile.proxies as ({ name?: string } | null)[] | undefined
  return Array.isArray(proxies) ? proxies.flatMap((proxy) => (proxy?.name ? [proxy.name] : [])) : []
}

export function rewriteMissingRuleProxyGroupTargets(profile: MihomoConfig): void {
  const groups = (profile['proxy-groups'] as ProxyGroupConfig[] | undefined) ?? []
  if (!groups.length) {
    return
  }

  const groupNames = new Set(groups.map((group) => group.name))
  const knownTargets = new Set([...groupNames, ...collectInlineProxyNames(profile)])
  rewriteRulePolicies(profile, ({ head, policy }) =>
    RULE_BUILTIN_TARGETS.has(policy) || knownTargets.has(policy)
      ? undefined
      : resolveMissingRuleTarget(policy, head[0].toUpperCase() === 'MATCH', groups, groupNames)
  )
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

const BUILTIN_GROUP_TARGETS = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
  'GLOBAL'
])

const MATCH_RULE_PATTERN = /^MATCH\s*,/i

/**
 * 兜底 MATCH：订阅 base 没有规则时，生成配置会一条 MATCH 都没有，
 * mihomo 对未命中流量默认走 DIRECT —— Google 等无专属规则的域名会直接撞墙
 * （实测：`www.google.com` SSL EOF，但走代理 200）。
 * 这里保证配置永远有最后一条 MATCH，目标优先主选择组。
 */
export function ensureMatchFallbackRule(profile: MihomoConfig): string | null {
  const rules = (profile.rules as string[] | undefined) ?? []
  if (rules.some((rule) => MATCH_RULE_PATTERN.test(rule.trim()))) {
    return null
  }

  const groups = (profile['proxy-groups'] as { name: string }[] | undefined) ?? []
  const names = new Set(groups.map((group) => group.name))
  const target = names.has(GENERAL_PROXY_GROUP_NAME)
    ? GENERAL_PROXY_GROUP_NAME
    : names.has(AUTO_SELECT_GROUP_NAME)
      ? AUTO_SELECT_GROUP_NAME
      : 'DIRECT'

  profile.rules = [...rules, `MATCH,${target}`] as MihomoConfig['rules']
  return target
}

/**
 * 订阅里的组可能引用已被重命名/下架的节点（实测：`🍃 应用净化` 引用 `🇭🇰 香港 I0B | AWS`，
 * 而节点已改名为 `🇭🇰 香港 I0B | AWS、IPv6 | 2x`），mihomo 会整份配置校验失败，
 * 导致启动流水线卡死、post-core 服务（含 Grok 探测）全部不启动。
 * 这里删除所有无法解析的成员引用；组被清空时补 `DIRECT`，保证配置永远可加载。
 */
export function dropUnknownGroupMembers(
  profile: MihomoConfig,
  leafProxyNames: readonly string[]
): Array<{ group: string; dropped: string[] }> {
  const groups = profile['proxy-groups'] as ProxyGroupConfig[] | undefined
  if (!groups?.length) {
    return []
  }

  const validTargets = new Set<string>(leafProxyNames)
  for (const group of groups) {
    validTargets.add(group.name)
  }
  for (const builtin of BUILTIN_GROUP_TARGETS) {
    validTargets.add(builtin)
  }

  const dropped: Array<{ group: string; dropped: string[] }> = []
  for (const group of groups) {
    const members = group.proxies
    if (!members?.length) {
      continue
    }
    const kept = members.filter((member) => validTargets.has(member))
    if (kept.length === members.length) {
      continue
    }
    const removed = members.filter((member) => !validTargets.has(member))
    if (kept.length > 0) {
      group.proxies = kept
    } else if (group.use?.length) {
      // provider 里还有成员，不能再塞 DIRECT：fallback / url-test 会把排在最前且必然存活的 DIRECT 选成出口
      delete group.proxies
    } else {
      group.proxies = ['DIRECT']
    }
    dropped.push({ group: group.name, dropped: removed })
  }
  return dropped
}
