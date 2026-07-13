/** Mirror of main `cursorProxyGroup.ts` — Cursor Selector group that affects Agent SSE. */

export const LEGACY_CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor-专用' as const
export const CURSOR_DEDICATED_GROUP_NAME = '🎯 Cursor 3.1.15 专用' as const
export const GENERAL_PROXY_GROUP_NAME = '🚀 节点选择' as const
export const CURSOR_DELAY_TEST_URL = 'https://api2.cursor.sh' as const
export const DEFAULT_GENERAL_DELAY_TEST_URL = 'https://www.gstatic.com/generate_204' as const

export function isCursorDedicatedGroupName(groupName: string): boolean {
  return groupName === CURSOR_DEDICATED_GROUP_NAME || groupName === LEGACY_CURSOR_DEDICATED_GROUP_NAME
}

export function resolveDelayTestUrl(groupName?: string, groupTestUrl?: string): string {
  if (groupName && isCursorSelectorGroupName(groupName)) {
    return CURSOR_DELAY_TEST_URL
  }
  return groupTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL
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
