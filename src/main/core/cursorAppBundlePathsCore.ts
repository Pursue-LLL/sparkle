// [INPUT] 无本地依赖
// [OUTPUT] CURSOR_*_APP_PATH_PREFIX · CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES · CURSOR_NODE_SELECT_APP_PATH_PREFIXES · CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES
// [POS] Cursor 应用安装路径前缀常量：主 / Latest / 2 / 3 四个安装包的路径限定规则全部走 `🎯 Cursor 专用`，节点选择与直连兜底前缀列表为空。

/** Cursor 3.x daily-driver bundle. */
export const CURSOR_3_APP_PATH_PREFIX = '/Applications/Cursor-3.app' as const

/** Stock Cursor daily driver (主安装). */
export const CURSOR_MAIN_APP_PATH_PREFIX = '/Applications/Cursor.app' as const

/** Latest-channel Cursor bundle. */
export const CURSOR_LATEST_APP_PATH_PREFIX = '/Applications/Cursor-Latest.app' as const

/** Secondary Cursor install (Agent experiments). */
export const CURSOR_2_APP_PATH_PREFIX = '/Applications/Cursor-2.app' as const

/**
 * Path-scoped rules → 🎯 Cursor 专用.
 * 主 / Latest / Cursor-3（及 Cursor-2）均走专用组，不再经 🚀 节点选择.
 */
export const CURSOR_DEDICATED_PROXY_APP_PATH_PREFIXES: readonly string[] = [
  CURSOR_MAIN_APP_PATH_PREFIX,
  CURSOR_LATEST_APP_PATH_PREFIX,
  CURSOR_2_APP_PATH_PREFIX,
  CURSOR_3_APP_PATH_PREFIX
]

/** Path-scoped rules → 🚀 节点选择 / 自动选择 — 无默认 bundle（专用列表已覆盖日常安装）. */
export const CURSOR_NODE_SELECT_APP_PATH_PREFIXES = [] as const

/** Path-scoped rules → DIRECT. Empty because every Cursor bundle uses Cursor 专用. */
export const CURSOR_DIRECT_FALLBACK_APP_PATH_PREFIXES = [] as const
