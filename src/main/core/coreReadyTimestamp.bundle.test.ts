import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'
import { validateSparkleMainAsarBundle } from '../../../scripts/upgradeSparkleAsarGateCore'

const outMainDir = join(process.cwd(), 'out/main')

describe('coreReadyTimestamp bundle guard', () => {
  it('networkStartupGraceCore chunk defines and exports markCoreReadyAtMs', () => {
    const chunkName = readdirSync(outMainDir).find(
      (name) => name.startsWith('networkStartupGraceCore-') && name.endsWith('.js'),
    )
    assert.ok(
      chunkName,
      'expected networkStartupGraceCore chunk under out/main/ — run electron-vite build first',
    )

    const source = readFileSync(join(outMainDir, chunkName), 'utf8')
    assert.match(source, /function markCoreReadyAtMs/)
    assert.match(source, /Object\.defineProperty\(exports, "markCoreReadyAtMs"/)
  })

  it('main index bundle links markCoreReadyAtMs via chunk export', () => {
    const mainPath = join(outMainDir, 'index.js')
    const source = readFileSync(mainPath, 'utf8')
    const gate = validateSparkleMainAsarBundle(source)
    assert.deepEqual(gate, { ok: true })
    assert.doesNotMatch(source, /\n\s*markCoreReadyAtMs\(\)/)
  })
})
