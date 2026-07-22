import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const outMainDir = join(process.cwd(), 'out/main')

describe('agentTransportFailureSync bundle guard', () => {
  it('uses appModule.getAppConfig() in built sync chunk (no destructured dynamic import)', () => {
    const chunkName = readdirSync(outMainDir).find((name) =>
      name.startsWith('agentTransportFailureSync-') && name.endsWith('.js'),
    )
    assert.ok(
      chunkName,
      'expected built agentTransportFailureSync chunk under out/main/ — run electron-vite build first',
    )

    const source = readFileSync(join(outMainDir, chunkName), 'utf8')
    assert.match(source, /\.getAppConfig\(\)/)
    assert.doesNotMatch(source, /const\s*\{\s*getAppConfig\s*\}\s*=\s*await/)
    assert.doesNotMatch(source, /getAppConfig\s*=\s*await\s*import\(['"]\.\.\/config['"]\)/)
  })
})
