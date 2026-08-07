/** Marathon / daily-driver Cursor bundle (observability + log discovery). */
export const MARATHON_CURSOR_APP_PATH_PREFIX = '/Applications/Cursor-3.1.15.app' as const

/** Only Cursor-2 Agent traffic uses the VPS dedicated selector. */
export const CURSOR_2_APP_PATH_PREFIX = '/Applications/Cursor-2.app' as const

/** Path-scoped rules → 🎯 Cursor 专用 (VPS). */
export const CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES = [CURSOR_2_APP_PATH_PREFIX] as const

/** Path-scoped rules → DIRECT (all other Cursor installs). */
export const CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES = [
  MARATHON_CURSOR_APP_PATH_PREFIX,
  '/Applications/Cursor.app'
] as const

/** Bundles counted as Cursor for marathon conn / hygiene (all local installs). */
export const MARATHON_CURSOR_APP_PATH_PREFIXES = [
  MARATHON_CURSOR_APP_PATH_PREFIX,
  CURSOR_2_APP_PATH_PREFIX
] as const

/** Substrings matched against mihomo connection metadata.processPath. */
export const CURSOR_APP_BUNDLE_PATH_MARKERS = [
  '/Cursor.app/',
  '/Cursor-3.1.15.app/',
  '/Cursor-2.app/'
] as const

export function isCursorAppBundleProcessPath(processPath: string): boolean {
  const path = processPath.trim()
  return CURSOR_APP_BUNDLE_PATH_MARKERS.some((marker) => path.includes(marker))
}
