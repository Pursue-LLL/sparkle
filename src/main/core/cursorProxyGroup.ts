/**
 * Shared helpers for the Cursor dedicated group contract.
 *
 * Contract: Cursor traffic needs a stable exit (session IP stickiness), so the
 * dedicated group must NOT be a url-test/load-balance auto-hopper. `fallback`
 * is the one sanctioned auto type: it pins the first healthy member (fixed
 * exit) and only switches on probe failure — disaster failover, not drift.
 */

const AUTO_SWITCHING_GROUP_TYPES = new Set<MihomoProxyType>([
  'URLTest',
  'LoadBalance',
  'Fallback',
  'Relay'
])

const AUTO_SWITCHING_PROXY_NAMES = new Set(['自动选择', '故障转移'])

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

export const GENERAL_PROXY_GROUP_NAME = '🚀 节点选择' as const

/** Current Sparkle name after BUG-2026-08-29-002 rewrite of subscription ♻️ / 节点选择. */
export const GENERAL_PROXY_GROUP_ALIAS_AUTO_SELECT = '自动选择' as const

export const GENERAL_PROXY_GROUP_NAMES = [
  GENERAL_PROXY_GROUP_NAME,
  GENERAL_PROXY_GROUP_ALIAS_AUTO_SELECT,
] as const

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
/** Hong Kong url-test group probes Grok reachability for Stripe/X/Grok traffic. */
export const HONG_KONG_DELAY_TEST_URL = 'https://grok.com' as const

const REGION_AUTO_SELECT_PREFIX = 'Sparkle-' as const

/** Url-test sub-group inside 自动选择 fallback — marathon-eligible VPS leaves only. */
export const CURSOR_AUTO_SELECT_GROUP_NAME = 'Sparkle-自动-Cursor' as const

export function isSparkleCursorAutoSelectGroup(groupName: string): boolean {
  return groupName === CURSOR_AUTO_SELECT_GROUP_NAME
}

export function isSparkleRegionalAutoSelectGroup(groupName: string): boolean {
  return (
    groupName.startsWith(REGION_AUTO_SELECT_PREFIX) &&
    !isSparkleCursorAutoSelectGroup(groupName) &&
    // Dedicated HK group and the 优选 picker share the `Sparkle-` prefix but are
    // managed on their own — they must not be treated as regional sub-groups.
    !isHongKongFilterGroupName(groupName)
  )
}

export function isSparkleAutoSelectSubGroup(groupName: string): boolean {
  return isSparkleRegionalAutoSelectGroup(groupName) || isSparkleCursorAutoSelectGroup(groupName)
}

export function isHongKongFilterGroupName(groupName: string): boolean {
  return groupName === 'Sparkle-香港' || groupName === '🇭🇰 香港节点'
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
  return options?.groupTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL
}

export function isCursorSelectorGroupName(groupName: string): boolean {
  return isCursorDedicatedGroupName(groupName)
}

export function isCursorSelectorGroupType(groupType: MihomoProxyType | string | undefined): boolean {
  if (!groupType) return false
  return groupType === 'Selector' || groupType.toLowerCase() === 'select'
}

/**
 * Group types allowed for the Cursor dedicated group: manual select plus
 * fallback (pins first healthy member; switches only on probe failure).
 * Auto-hop url-test/load-balance/relay stay forbidden — exit IP drift.
 */
export function isCursorDedicatedGroupType(
  groupType: MihomoProxyType | string | undefined
): boolean {
  if (isCursorSelectorGroupType(groupType)) return true
  return groupType?.toLowerCase() === 'fallback'
}

/** Stable-exit Cursor group — manual select or fallback (failover-only switching). */
export function resolveCursorStableSelectorGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  const canonical = groups.find(
    (group) =>
      group.name === CURSOR_DEDICATED_GROUP_NAME && isCursorDedicatedGroupType(group.type)
  )
  if (canonical) {
    return canonical
  }
  return groups.find(
    (group) => isCursorDedicatedGroupName(group.name) && isCursorDedicatedGroupType(group.type)
  )
}

export function resolveGeneralProxySelectGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  for (const name of GENERAL_PROXY_GROUP_NAMES) {
    const match = groups.find(
      (group) => group.name === name && isCursorSelectorGroupType(group.type),
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
