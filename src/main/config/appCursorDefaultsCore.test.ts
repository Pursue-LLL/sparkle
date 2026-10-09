import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_2_APP_PATH_PREFIX } from '../core/cursorAppBundlePathsCore'
import { migrateLegacyCursorDefaults } from './appCursorDefaultsCore'

function baseConfig(): AppConfig {
  return {
    sysProxy: { enable: false, mode: 'manual' },
    autoCloseConnection: false,
    cursorBidiOptimize: true,
    cursorSysProxyLock: false,
    cursorProxyAppPathPrefixes: []
  } as unknown as AppConfig
}

describe('migrateLegacyCursorDefaults', () => {
  it('migrates legacy Cursor-3.1.15 dedicated prefix to empty (node-select default)', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: ['/Applications/Cursor-3.1.15.app']
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, true)
  })

  it('defaults missing cursorProxyAppPathPrefixes to empty', () => {
    const input = {
      sysProxy: { enable: false, mode: 'manual' },
      cursorBidiOptimize: true,
      cursorSysProxyLock: false
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, true)
  })

  it('migrates dual-prefix legacy config to empty', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: [
        '/Applications/Cursor-3.1.15.app',
        '/Applications/Cursor-2.app'
      ]
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, true)
  })

  it('migrates Cursor-2-only dedicated prefix to empty', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: [CURSOR_2_APP_PATH_PREFIX]
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, true)
  })

  it('preserves empty dedicated prefix', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: []
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, false)
  })

  it('migrates legacy autoCloseConnection', () => {
    const input = {
      ...baseConfig(),
      autoCloseConnection: true
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.equal(config.autoCloseConnection, false)
    assert.equal(migrated, true)
  })
})
