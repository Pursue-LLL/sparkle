import assert from 'node:assert/strict'
import { mkdirSync } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import { discoverCursorLogRoots } from './cursorLogDiscoveryCore'

describe('cursorLogDiscoveryCore', () => {
  it('discovers stock Cursor/logs and Cursor-*-data/logs roots', () => {
    const home = mkdtempSync(join(tmpdir(), 'sparkle-log-discovery-'))
    const support = join(home, 'Library', 'Application Support')
    const stockCursor = join(support, 'Cursor', 'logs', '20260727T120000')
    const dataCursor = join(support, 'Cursor-3.1.15-data', 'logs', '20260727T120000')
    const customData = join(support, 'Cursor-custom-data', 'logs', '20260727T120000')
    const noLogs = join(support, 'Cursor-2-data')
    mkdirSync(stockCursor, { recursive: true })
    mkdirSync(dataCursor, { recursive: true })
    mkdirSync(customData, { recursive: true })
    mkdirSync(noLogs, { recursive: true })

    const roots = discoverCursorLogRoots({
      applicationSupportDir: support,
      appPathPrefixes: ['/Applications/Cursor-custom.app'],
    })

    assert.ok(roots.includes(join(support, 'Cursor')))
    assert.ok(roots.includes(join(support, 'Cursor-3.1.15-data')))
    assert.ok(roots.includes(join(support, 'Cursor-custom-data')))
    assert.ok(!roots.includes(noLogs))

    rmSync(home, { recursive: true, force: true })
  })
})
