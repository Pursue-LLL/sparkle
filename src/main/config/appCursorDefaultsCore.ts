/** Seed Cursor rule defaults on configs created before the Cursor group existed. */
export function migrateLegacyCursorDefaults(config: AppConfig): {
  config: AppConfig
  migrated: boolean
} {
  const result = { ...config }
  let migrated = false

  if (result.cursorBidiOptimize === undefined) {
    result.cursorBidiOptimize = true
    migrated = true
  }
  if (result.cursorProxyAppPathPrefixes === undefined) {
    result.cursorProxyAppPathPrefixes = []
    migrated = true
  }

  const prefixes = result.cursorProxyAppPathPrefixes ?? []
  if (prefixes.length > 0) {
    result.cursorProxyAppPathPrefixes = []
    migrated = true
  }

  return { config: result, migrated }
}
