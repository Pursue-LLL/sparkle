import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  collectSparkleMainProcessDiskSource,
  listSparkleMainProcessJsDiskPaths,
} from './sparkleMainAsarSourceCore'
import { validateSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore'

describe('sparkleMainAsarSourceCore disk collector', () => {
  it('aggregates split chunks on disk like packaged asar', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sparkle-main-out-'))
    writeFileSync(
      path.join(dir, 'index.js'),
      'appendAppLog .markCoreReadyAtMs(',
      'utf8',
    )
    writeFileSync(
      path.join(dir, 'coreReadinessGate-abc.js'),
      '[CoreReadiness]: runCoreReadinessPipeline',
      'utf8',
    )

    assert.equal(listSparkleMainProcessJsDiskPaths(dir).length, 2)
    const source = collectSparkleMainProcessDiskSource(dir)
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })
})
