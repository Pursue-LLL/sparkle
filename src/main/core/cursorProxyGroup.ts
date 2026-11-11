/** Shared helpers: Cursor traffic must use fixed Selector nodes, never UrlTest auto-hop. */

const AUTO_SWITCHING_GROUP_TYPES = new Set<MihomoProxyType>([
  'URLTest',
  'LoadBalance',
  'Fallback',
  'Relay'
])

/** Sparkle 重写订阅 ♻️ / 节点选择 后的 fallback 自动选择组（粘性固定组）。 */
export const AUTO_SELECT_GROUP_NAME = '自动选择' as const

const AUTO_SWITCHING_PROXY_NAMES = new Set<string>([AUTO_SELECT_GROUP_NAME, '故障转移'])

export function isAutoSwitchingGroupType(groupType: MihomoProxyType | string | undefined): boolean {
  if (!groupType) return false
  return AUTO_SWITCHING_GROUP_TYPES.has(groupType as MihomoProxyType)
}

export function isAutoSwitchingProxyName(proxyName: string): boolean {
  return AUTO_SWITCHING_PROXY_NAMES.has(proxyName)
}

/** Legacy injected group names — migrated to {@link CURSOR_DEDICATED_GROUP_NAME} on profile regen. */
export const LEGACY_CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor-专用' as const

export const PREVIOUS_CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor 3.1.15 专用' as const

export const LEGACY_CURSOR_DEDICATED_GROUP_NAMES = [
  LEGACY_CURSOR_DEDICATED_GROUP_NAME,
  PREVIOUS_CURSOR_DEDICATED_GROUP_NAME
] as const

export const CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor 专用' as const

export const MAIL_DEDICATED_GROUP_NAME = '📧 邮件专用' as const
export const MAIL_PROBE_HIDDEN_GROUP_NAME = '__sparkle_mail_probe__' as const

/** Grok 专用出口组：select + 应用层探针选一个固定节点，避免 url-test 全量排名。 */
export const GROK_DEDICATED_GROUP_NAME = 'grok 专用' as const

/** Antigravity / Code Assist（cloudcode-pa）专用出口组：只收真实 agy 请求验证通过的节点。 */
export const AGY_DEDICATED_GROUP_NAME = '🎯 agy 专用' as const

/** Cursor 专用组 provider 模式的 VPS 过滤器：只收 Reality / HY2 叶子。 */
export const CURSOR_VPS_PROVIDER_FILTER = '(?i)-VPS-(Reality|HY2)$'

const CURSOR_EXCLUDED_VPS_LEAF_RE = /-VPS-TLS$/i

/** Cursor 专用组不收录 TLS canary（:18443）VPS 叶子。 */
export function filterCursorEligibleVpsLeaves(leaves: readonly string[]): string[] {
  return leaves.filter((name) => !CURSOR_EXCLUDED_VPS_LEAF_RE.test(name.trim()))
}

export const GENERAL_PROXY_GROUP_NAME = '🚀 节点选择' as const

export const GENERAL_PROXY_GROUP_NAMES = [GENERAL_PROXY_GROUP_NAME, AUTO_SELECT_GROUP_NAME] as const

/** Built-in Mihomo leaf — lets operators bypass VPS for Cursor traffic (L1 baseline / company network). */
export const CURSOR_DEDICATED_DIRECT_PROXY = 'DIRECT' as const

export function prependCursorDedicatedDirectOption(members: readonly string[]): string[] {
  const withoutDirect = members.filter((name) => name !== CURSOR_DEDICATED_DIRECT_PROXY)
  return [CURSOR_DEDICATED_DIRECT_PROXY, ...withoutDirect]
}

export const CURSOR_DELAY_TEST_URL = 'https://api2.cursor.sh' as const
export const DEFAULT_GENERAL_DELAY_TEST_URL = 'https://www.gstatic.com/generate_204' as const
/** Gemini reachability probe — a healthy exit must open Gemini itself, not merely pass TCP. */
export const GEMINI_REACHABILITY_PROBE_URL = 'https://gemini.google.com' as const
/** Regional Sparkle 自动选择 url-test groups probe ChatGPT reachability, not generic 204. */
export const AUTO_SELECT_DELAY_TEST_URL = 'https://chatgpt.com' as const
/** Grok 专用组探针：Cloudflare 对不可信出口回 403 challenge，只有 200 才代表真能打开 Grok。 */
export const GROK_DELAY_TEST_URL = 'https://grok.com' as const
/** Hong Kong url-test group serves X/Twitter/Stripe — probe X, the traffic it actually carries. */
export const HONG_KONG_DELAY_TEST_URL = 'https://x.com' as const
/** Mail dedicated url-test group measures RTT among IMAPS/SMTPS-verified nodes. */
export const MAIL_DELAY_TEST_URL = 'https://mail.google.com' as const

export const REGION_AUTO_SELECT_PREFIX = 'Sparkle-' as const

/** Url-test sub-group inside 自动选择 fallback — Cursor-eligible VPS leaves only. */
export const CURSOR_AUTO_SELECT_GROUP_NAME = 'Sparkle-自动-Cursor' as const

export function isSparkleCursorAutoSelectGroup(groupName: string): boolean {
  return groupName === CURSOR_AUTO_SELECT_GROUP_NAME
}

export function isSparkleRegionalAutoSelectGroup(groupName: string): boolean {
  return (
    groupName.startsWith(REGION_AUTO_SELECT_PREFIX) &&
    !isSparkleCursorAutoSelectGroup(groupName) &&
    // Dedicated HK / Grok groups share the `Sparkle-` prefix but are managed on
    // their own — they must not be treated as regional sub-groups.
    !isHongKongFilterGroupName(groupName) &&
    !isGrokDedicatedGroupName(groupName)
  )
}

export function isSparkleAutoSelectSubGroup(groupName: string): boolean {
  return isSparkleRegionalAutoSelectGroup(groupName) || isSparkleCursorAutoSelectGroup(groupName)
}

export function isHongKongFilterGroupName(groupName: string): boolean {
  return groupName === 'Sparkle-香港' || groupName === '🇭🇰 香港节点'
}

export function isGrokDedicatedGroupName(groupName: string): boolean {
  return groupName === GROK_DEDICATED_GROUP_NAME
}

export function isMailDedicatedGroupName(groupName: string): boolean {
  return groupName === MAIL_DEDICATED_GROUP_NAME
}

export function isAgyDedicatedGroupName(groupName: string): boolean {
  return groupName === AGY_DEDICATED_GROUP_NAME
}

export function isMailProbeHiddenGroupName(groupName: string): boolean {
  return groupName === MAIL_PROBE_HIDDEN_GROUP_NAME
}

export function isCursorDedicatedGroupName(groupName: string): boolean {
  return (
    groupName === CURSOR_DEDICATED_GROUP_NAME ||
    LEGACY_CURSOR_DEDICATED_GROUP_NAMES.some((legacyName) => legacyName === groupName)
  )
}

export function resolveDelayTestUrl(options?: {
  groupName?: string
  groupTestUrl?: string
  forceCursorProbe?: boolean
}): string {
  if (
    options?.forceCursorProbe ||
    (options?.groupName && isCursorSelectorGroupName(options.groupName))
  ) {
    return CURSOR_DELAY_TEST_URL
  }
  if (options?.groupName && isSparkleCursorAutoSelectGroup(options.groupName)) {
    return options.groupTestUrl || CURSOR_DELAY_TEST_URL
  }
  if (options?.groupName && isSparkleRegionalAutoSelectGroup(options.groupName)) {
    return options.groupTestUrl || AUTO_SELECT_DELAY_TEST_URL
  }
  if (options?.groupName && isHongKongFilterGroupName(options.groupName)) {
    return options.groupTestUrl || HONG_KONG_DELAY_TEST_URL
  }
  if (options?.groupName && isGrokDedicatedGroupName(options.groupName)) {
    return options.groupTestUrl || GROK_DELAY_TEST_URL
  }
  if (options?.groupName && isMailDedicatedGroupName(options.groupName)) {
    return options.groupTestUrl || MAIL_DELAY_TEST_URL
  }
  return options?.groupTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL
}

export function isCursorSelectorGroupName(groupName: string): boolean {
  return isCursorDedicatedGroupName(groupName)
}

export function isCursorSelectorGroupType(
  groupType: MihomoProxyType | string | undefined
): boolean {
  if (!groupType) return false
  return groupType === 'Selector' || groupType.toLowerCase() === 'select'
}

export function resolveCursorStableSelectorGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  const canonical = groups.find(
    (group) => group.name === CURSOR_DEDICATED_GROUP_NAME && isCursorSelectorGroupType(group.type)
  )
  if (canonical) {
    return canonical
  }
  return groups.find(
    (group) => isCursorDedicatedGroupName(group.name) && isCursorSelectorGroupType(group.type)
  )
}

export function resolveGeneralProxySelectGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  for (const name of GENERAL_PROXY_GROUP_NAMES) {
    const match = groups.find(
      (group) => group.name === name && isCursorSelectorGroupType(group.type)
    )
    if (match) {
      return match
    }
  }
  return undefined
}

export function resolveGroupByName(
  groups: ControllerMixedGroup[],
  name: string
): ControllerMixedGroup | undefined {
  return groups.find((group) => group.name === name)
}

/** True when the active selection is a UrlTest/LoadBalance/Fallback group (mihomo auto-hops). */
export function isNestedAutoSwitchSelection(
  proxyName: string,
  groups: ControllerMixedGroup[]
): boolean {
  const nested = resolveGroupByName(groups, proxyName)
  if (!nested) return false
  return isAutoSwitchingGroupType(nested.type)
}
