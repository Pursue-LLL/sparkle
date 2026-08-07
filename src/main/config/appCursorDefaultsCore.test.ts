import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_2_APP_PATH_PREFIX } from '../core/cursorAppBundlePathsCore'
import { migrateLegacyCursorDefaults } from './appCursorDefaultsCore'

function baseConfig(): AppConfig {
  return {
    sysProxy: { enable: false, mode: 'manual' },
    autoProxySwitch: true,
    autoCloseConnection: false,
    proxyHealthCheckInterval: 60,
    cursorBidiOptimize: true,
    cursorSysProxyLock: false,
    cursorProxyAppPathPrefixes: []
  } as AppConfig
}

describe('migrateLegacyCursorDefaults', () => {
  it('migrates legacy Cursor-3.1.15 dedicated prefix to Cursor-2 only', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: ['/Applications/Cursor-3.1.15.app']
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [CURSOR_2_APP_PATH_PREFIX])
    assert.equal(migrated, true)
  })

  it('defaults missing cursorProxyAppPathPrefixes to Cursor-2 only', () => {
    const input = {
      sysProxy: { enable: false, mode: 'manual' },
      cursorBidiOptimize: true,
      cursorSysProxyLock: false
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [CURSOR_2_APP_PATH_PREFIX])
    assert.equal(migrated, true)
  })

  it('migrates dual-prefix legacy config to Cursor-2 only', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: [
        '/Applications/Cursor-3.1.15.app',
        '/Applications/Cursor-2.app'
      ]
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [CURSOR_2_APP_PATH_PREFIX])
    assert.equal(migrated, true)
  })

  it('preserves Cursor-2-only dedicated prefix', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: [CURSOR_2_APP_PATH_PREFIX]
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [CURSOR_2_APP_PATH_PREFIX])
    assert.equal(migrated, false)
  })

  it('migrates legacy autoCloseConnection and proxyHealthCheckInterval', () => {
    const input = {
      ...baseConfig(),
      autoCloseConnection: true,
      proxyHealthCheckInterval: 120
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.equal(config.autoCloseConnection, false)
    assert.equal(config.proxyHealthCheckInterval, 60)
    assert.equal(migrated, true)
  })
})
