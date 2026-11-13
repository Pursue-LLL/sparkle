// [INPUT] cursorDedicatedRuleRewrite::migrateLegacyCursorDedicatedGroupReferences/rewriteBroadCursorDedicatedRules (POS: Cursor 专用组规则整理) ·
//         cursorProxyGroup::CURSOR_DEDICATED_GROUP_NAME/CURSOR_DEDICATED_DIRECT_PROXY/CURSOR_VPS_PROVIDER_FILTER/filterCursorEligibleVpsLeaves… (POS: Sparkle 分组名常量与判定谓词) ·
//         ruleSyntax::rewriteRulePolicies (POS: 规则文本解析与策略改写) ·
//         sparkleAgyProviderCore::buildAgyGroupConfig (POS: agy provider 与分组配置) ·
//         sparkleGeminiProviderCore::buildGeminiGroupConfig (POS: gemini provider 与分组配置) ·
//         sparkleGrokProviderCore::GROK_NODE_PROVIDER_ID (POS: grok provider 与快照) ·
//         sparkleMailProviderCore::buildMailGroupConfig/buildMailProbeHiddenGroupConfig/ensureMailProbeListener (POS: 邮件 provider 与分组配置) ·
//         vpsProviderSplitCore::resolveVpsProviderId (POS: VPS 节点拆分与 provider id)
// [OUTPUT] HONG_KONG_FILTER_GROUP_NAME · ensureCustomProxyGroups: 注入 / 刷新 Sparkle 自有分组
// [POS] Sparkle 自有分组注入：`🎯 Cursor 专用`、`Sparkle-香港`、`grok 专用`、`gemini专用`、`📧 邮件专用`、隐藏探测组与 `🎯 agy 专用` 放在订阅分组之前；订阅自带分组原样保留，并迁移指向旧 Cursor 组名的引用与规则。

import {
  CURSOR_DEDICATED_GROUP_NAME,
  CURSOR_DEDICATED_DIRECT_PROXY,
  CURSOR_VPS_PROVIDER_FILTER,
  filterCursorEligibleVpsLeaves,
  LEGACY_CURSOR_DEDICATED_GROUP_NAMES,
  prependCursorDedicatedDirectOption,
  AGY_DEDICATED_GROUP_NAME,
  GEMINI_DEDICATED_GROUP_NAME,
  HONG_KONG_DELAY_TEST_URL,
  GROK_DEDICATED_GROUP_NAME,
  MAIL_DEDICATED_GROUP_NAME,
  MAIL_PROBE_HIDDEN_GROUP_NAME
} from './cursorProxyGroup'
import {
  migrateLegacyCursorDedicatedGroupReferences,
  rewriteBroadCursorDedicatedRules
} from './cursorDedicatedRuleRewrite'
import { buildAgyGroupConfig } from './sparkleAgyProviderCore'
import { buildGeminiGroupConfig } from './sparkleGeminiProviderCore'
import {
  buildMailGroupConfig,
  buildMailProbeHiddenGroupConfig,
  ensureMailProbeListener
} from './sparkleMailProviderCore'
import { GROK_NODE_PROVIDER_ID } from './sparkleGrokProviderCore'
import { rewriteRulePolicies } from './ruleSyntax'
import { resolveVpsProviderId } from './vpsProviderSplitCore'

/** Sparkle-injected HK filter group — members rebuilt on every generateProfile(). */
export const HONG_KONG_FILTER_GROUP_NAME = 'Sparkle-香港' as const

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

const HONG_KONG_HOP_GROUP_NAMES = new Set(['🚀 节点选择', 'GLOBAL'])

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
  fromTargets: ReadonlySet<string>,
  toTarget: string
): void {
  rewriteRulePolicies(profile, ({ policy }) => (fromTargets.has(policy) ? toTarget : undefined))
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

function buildCursorGroupConfig(
  leafNames: string[],
  profileId: string | undefined
): ProxyGroupConfig {
  const vpsNodes = filterCursorEligibleVpsLeaves([
    ...new Set(leafNames.filter(matchesVpsNode))
  ]).sort((a, b) => a.localeCompare(b, 'zh-CN'))

  // 没有自建节点时组依然存在：成员由地区组 / 自动选择补齐，而不是整组消失导致规则悬空。
  if (profileId) {
    const group: ProxyGroupConfig = {
      name: CURSOR_DEDICATED_GROUP_NAME,
      type: 'select',
      proxies: [CURSOR_DEDICATED_DIRECT_PROXY]
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
    proxies: prependCursorDedicatedDirectOption(vpsNodes)
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

  const injected: ProxyGroupConfig[] = [buildCursorGroupConfig(leafProxyNames, profileId)]
  const hkGroup = buildHongKongGroupConfig(leafProxyNames, profileId)
  const grokGroup = buildGrokGroupConfig(leafProxyNames, profileId)
  const geminiGroup = buildGeminiGroupConfig(leafProxyNames, profileId)
  const mailGroup = buildMailGroupConfig(leafProxyNames, profileId)
  const mailProbeGroup = buildMailProbeHiddenGroupConfig(profileId)
  const agyGroup = buildAgyGroupConfig(leafProxyNames, profileId)

  if (hkGroup) {
    injected.push(hkGroup)
  }
  if (grokGroup) {
    injected.push(grokGroup)
  }
  if (geminiGroup) {
    injected.push(geminiGroup)
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
