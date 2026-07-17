/** Shared helpers: Cursor traffic must use fixed Selector nodes, never UrlTest auto-hop. */

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

export const CURSOR_DELAY_TEST_URL = 'https://api2.cursor.sh' as const
export const DEFAULT_GENERAL_DELAY_TEST_URL = 'https://www.gstatic.com/generate_204' as const
/** Regional Sparkle 自动选择 url-test groups probe ChatGPT reachability, not generic 204. */
export const AUTO_SELECT_DELAY_TEST_URL = 'https://chatgpt.com' as const
/** Hong Kong url-test group probes Grok reachability for Stripe/X/Grok traffic. */
export const HONG_KONG_DELAY_TEST_URL = 'https://grok.com' as const

const REGION_AUTO_SELECT_PREFIX = 'Sparkle-自动-' as const

export function isSparkleRegionalAutoSelectGroup(groupName: string): boolean {
  return groupName.startsWith(REGION_AUTO_SELECT_PREFIX)
}

export function isHongKongFilterGroupName(groupName: string): boolean {
  return groupName === '🇭🇰 香港节点'
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

export function resolveCursorStableSelectorGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  const canonical = groups.find(
    (group) =>
      group.name === CURSOR_DEDICATED_GROUP_NAME && isCursorSelectorGroupType(group.type)
  )
  if (canonical) {
    return canonical
  }
  return groups.find(
    (group) => isCursorDedicatedGroupName(group.name) && isCursorSelectorGroupType(group.type)
  )
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
