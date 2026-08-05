/** Marathon / Cursor dedicated proxy group — macOS .app bundle install paths. */
export const MARATHON_CURSOR_APP_PATH_PREFIX = '/Applications/Cursor-3.1.15.app' as const

export const CURSOR_2_APP_PATH_PREFIX = '/Applications/Cursor-2.app' as const

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
