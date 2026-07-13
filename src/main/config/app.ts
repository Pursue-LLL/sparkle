import { readFile, writeFile, rename, copyFile, unlink } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'
import { readFileSync, existsSync } from 'fs'
import { decryptLegacyString, isLegacyEncryptedString } from '../utils/encrypt'

let appConfig: AppConfig
let writePromise: Promise<void> = Promise.resolve()

const LEGACY_ENCRYPTED_FIELDS = ['systemCorePath', 'serviceAuthKey'] as const

function isValidConfig(config: unknown): config is AppConfig {
  if (!config || typeof config !== 'object') return false
  const cfg = config as Partial<AppConfig>
  return 'sysProxy' in cfg && typeof cfg.sysProxy === 'object' && cfg.sysProxy !== null
}

async function safeWriteConfig(content: string): Promise<void> {
  const configPath = appConfigPath()
  const tmpPath = `${configPath}.tmp`
  const backupPath = `${configPath}.backup`

  try {
    await writeFile(tmpPath, content, 'utf-8')
    if (existsSync(configPath)) {
      await copyFile(configPath, backupPath)
      if (process.platform === 'win32') {
        await unlink(configPath)
      }
    }
    if (existsSync(tmpPath)) {
      await rename(tmpPath, configPath)
    }
  } catch (e) {
    if (existsSync(tmpPath)) {
      try {
        await unlink(tmpPath)
      } catch {
        // ignore
      }
    }
    throw e
  }
}

function migrateLegacyEncryptedConfig(config: AppConfig): { config: AppConfig; migrated: boolean } {
  const result = { ...config }
  let migrated = false

  // Compatibility shim for the safeStorage-backed `enc:` format.
  // TODO(next version): remove this read-time migration after users have had one release to rewrite plaintext config.
  for (const field of LEGACY_ENCRYPTED_FIELDS) {
    const value = result[field]
    if (!isLegacyEncryptedString(value)) continue

    try {
      ;(result[field] as string) = decryptLegacyString(value)
      migrated = true
    } catch {
      // Keep the legacy value intact if the current system cannot decrypt it.
    }
  }

  return { config: result, migrated }
}

/** Upgrade legacy Sparkle defaults to Cursor-optimized stability settings. */
function migrateLegacyCursorDefaults(config: AppConfig): { config: AppConfig; migrated: boolean } {
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
    result.cursorProxyAppPathPrefixes = [...defaultConfig.cursorProxyAppPathPrefixes!]
    migrated = true
  }
  if (result.cursorSysProxyLock === undefined && result.cursorBidiOptimize !== false) {
    result.cursorSysProxyLock = false
  }

  return { config: result, migrated }
}

async function writeCurrentConfig(): Promise<void> {
  const previousPromise = writePromise
  writePromise = (async () => {
    await previousPromise
    await safeWriteConfig(stringifyYaml(appConfig))
  })()
  await writePromise
}

export async function getAppConfig(force = false): Promise<AppConfig> {
  if (force || !appConfig) {
    try {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsed = parseYaml<AppConfig>(data)
      let migrated = false
      if (!parsed || !isValidConfig(parsed)) {
        const backup = await readFile(`${appConfigPath()}.backup`, 'utf-8')
        const migration = migrateLegacyEncryptedConfig(parseYaml<AppConfig>(backup))
        const cursorMigration = migrateLegacyCursorDefaults(migration.config)
        appConfig = deepMerge({ ...defaultConfig }, cursorMigration.config)
        migrated = migration.migrated || cursorMigration.migrated
      } else {
        const migration = migrateLegacyEncryptedConfig(parsed)
        const cursorMigration = migrateLegacyCursorDefaults(migration.config)
        appConfig = deepMerge({ ...defaultConfig }, cursorMigration.config)
        migrated = migration.migrated || cursorMigration.migrated
      }
      if (migrated) {
        try {
          await writeCurrentConfig()
        } catch {
          // Keep the decrypted config in memory even if the compatibility writeback fails.
        }
      }
    } catch (e) {
      appConfig = defaultConfig
    }
  }
  if (typeof appConfig !== 'object') appConfig = defaultConfig
  return appConfig
}

export async function patchAppConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const previousPromise = writePromise
  writePromise = (async () => {
    await previousPromise
    appConfig = deepMerge(appConfig, patch)
    await safeWriteConfig(stringifyYaml(appConfig))
  })()
  await writePromise
  return appConfig
}

export function getAppConfigSync(): AppConfig {
  try {
    const raw = readFileSync(appConfigPath(), 'utf-8')
    const data = parseYaml<AppConfig>(raw)
    if (typeof data === 'object' && data !== null) {
      return deepMerge({ ...defaultConfig }, migrateLegacyEncryptedConfig(data).config)
    }
    return defaultConfig
  } catch (e) {
    return defaultConfig
  }
}
