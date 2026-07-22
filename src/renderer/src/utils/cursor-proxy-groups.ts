/** Mirror of main `cursorProxyGroup.ts` — Cursor Selector group that affects Agent SSE. */

export const LEGACY_CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor-专用' as const
export const PREVIOUS_CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor 3.1.15 专用' as const
export const LEGACY_CURSOR_DEDICATED_GROUP_NAMES = [
  LEGACY_CURSOR_DEDICATED_GROUP_NAME,
  PREVIOUS_CURSOR_DEDICATED_GROUP_NAME
] as const
export const CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor 专用' as const
export const GENERAL_PROXY_GROUP_NAME = '🚀 节点选择' as const
export const CURSOR_DELAY_TEST_URL = 'https://api2.cursor.sh' as const
export const DEFAULT_GENERAL_DELAY_TEST_URL = 'https://www.gstatic.com/generate_204' as const
export const AUTO_SELECT_DELAY_TEST_URL = 'https://chatgpt.com' as const
export const HONG_KONG_DELAY_TEST_URL = 'https://grok.com' as const

const REGION_AUTO_SELECT_PREFIX = 'Sparkle-自动-' as const
const HONG_KONG_FILTER_GROUP_NAME = '🇭🇰 香港节点' as const

function isSparkleRegionalAutoSelectGroup(groupName: string): boolean {
  return groupName.startsWith(REGION_AUTO_SELECT_PREFIX)
}

function isHongKongFilterGroupName(groupName: string): boolean {
  return groupName === HONG_KONG_FILTER_GROUP_NAME
}

export function isCursorDedicatedGroupName(groupName: string): boolean {
  return (
    groupName === CURSOR_DEDICATED_GROUP_NAME ||
    LEGACY_CURSOR_DEDICATED_GROUP_NAMES.some((legacyName) => legacyName === groupName)
  )
}

export function resolveDelayTestUrl(groupName?: string, groupTestUrl?: string): string {
  if (groupName && isCursorSelectorGroupName(groupName)) {
    return CURSOR_DELAY_TEST_URL
  }
  if (groupName && isSparkleRegionalAutoSelectGroup(groupName)) {
    return groupTestUrl || AUTO_SELECT_DELAY_TEST_URL
  }
  if (groupName && isHongKongFilterGroupName(groupName)) {
    return groupTestUrl || HONG_KONG_DELAY_TEST_URL
  }
  return groupTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL
}

export function resolveEffectiveDelayTestUrl(options: {
  groupName?: string
  groupTestUrl?: string
  delayTestUrlScope?: 'group' | 'global'
  globalDelayTestUrl?: string
}): string {
  if (options.delayTestUrlScope === 'global') {
    const trimmed = options.globalDelayTestUrl?.trim()
    return trimmed || DEFAULT_GENERAL_DELAY_TEST_URL
  }
  return resolveDelayTestUrl(options.groupName, options.groupTestUrl)
}

/** Compact hostname/path label for group headers. */
export function formatDelayTestUrlDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return url
  }
}

export function isCursorSelectorGroupName(groupName: string): boolean {
  return isCursorDedicatedGroupName(groupName)
}

export function cursorProxySwitchConfirmDescription(
  groupName: string,
  fromProxy: string,
  toProxy: string
): string {
  return `「${groupName}」将从「${fromProxy}」切换到「${toProxy}」。运行中的 Cursor Agent 长连接会断开，可能触发额外计次。确认切换？`
}
