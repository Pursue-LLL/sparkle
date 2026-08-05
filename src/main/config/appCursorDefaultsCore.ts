import {
  CURSOR_2_APP_PATH_PREFIX,
  MARATHON_CURSOR_APP_PATH_PREFIX,
  MARATHON_CURSOR_APP_PATH_PREFIXES
} from '../core/cursorAppBundlePathsCore'

/** Upgrade legacy Sparkle defaults to Cursor-optimized stability settings. */
export function migrateLegacyCursorDefaults(config: AppConfig): {
  config: AppConfig
  migrated: boolean
} {
  const result = { ...config }
  let migrated = false

  if (result.autoProxySwitch === undefined) {
    result.autoProxySwitch = true
    migrated = true
  }
  if (result.autoCloseConnection === true) {
    result.autoCloseConnection = false
    migrated = true
  }
  if (result.proxyHealthCheckInterval === 120) {
    result.proxyHealthCheckInterval = 60
    migrated = true
  }
  if (result.cursorBidiOptimize === undefined) {
    result.cursorBidiOptimize = true
    migrated = true
  }
  if (result.cursorProxyAppPathPrefixes === undefined) {
    result.cursorProxyAppPathPrefixes = []
    migrated = true
  }

  const prefixes = result.cursorProxyAppPathPrefixes ?? []
  if (
    prefixes.includes(MARATHON_CURSOR_APP_PATH_PREFIX) &&
    !prefixes.includes(CURSOR_2_APP_PATH_PREFIX)
  ) {
    result.cursorProxyAppPathPrefixes = [...prefixes, CURSOR_2_APP_PATH_PREFIX]
    migrated = true
  }
  if (result.cursorSysProxyLock === undefined && result.cursorBidiOptimize !== false) {
    result.cursorSysProxyLock = false
  }

  return { config: result, migrated }
}
