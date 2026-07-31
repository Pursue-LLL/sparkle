import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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
  it('preserves explicit Cursor-3.1.15 path prefix (must not clear on read)', () => {
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: ['/Applications/Cursor-3.1.15.app']
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, ['/Applications/Cursor-3.1.15.app'])
    assert.equal(migrated, false)
  })

  it('defaults missing cursorProxyAppPathPrefixes to empty array', () => {
    const input = {
      sysProxy: { enable: false, mode: 'manual' },
      cursorBidiOptimize: true,
      cursorSysProxyLock: false
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, [])
    assert.equal(migrated, true)
  })

  it('preserves multiple explicit app path prefixes', () => {
    const prefixes = ['/Applications/Cursor-3.1.15.app', '/Applications/Cursor-2.app']
    const input = {
      ...baseConfig(),
      cursorProxyAppPathPrefixes: prefixes
    } as AppConfig

    const { config, migrated } = migrateLegacyCursorDefaults(input)

    assert.deepEqual(config.cursorProxyAppPathPrefixes, prefixes)
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
