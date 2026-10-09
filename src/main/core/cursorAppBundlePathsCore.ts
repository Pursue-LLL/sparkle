/** Cursor 3.x daily-driver bundle. */
export const CURSOR_3_APP_PATH_PREFIX = '/Applications/Cursor-3.app' as const

/** Stock Cursor daily driver. */
export const CURSOR_MAIN_APP_PATH_PREFIX = '/Applications/Cursor.app' as const

/** Secondary Cursor install (Agent experiments). */
export const CURSOR_2_APP_PATH_PREFIX = '/Applications/Cursor-2.app' as const

/**
 * Path-scoped rules → 🎯 Cursor 专用.
 * Cursor-2 / Cursor-3 only — stock Cursor.app uses 自动选择.
 */
export const CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES: readonly string[] = [
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX,
]

/** Path-scoped rules → 🚀 节点选择 / 自动选择 (stock Cursor daily driver). */
export const CURSOR_NODE_SELECT_APP_PATH_PREFIXES = [CURSOR_MAIN_APP_PATH_PREFIX] as const

/** Path-scoped rules → DIRECT. Empty because every Cursor bundle uses Cursor 专用. */
export const CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES = [] as const
