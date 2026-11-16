import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  collectSparkleMainProcessDiskSource,
  listSparkleMainProcessJsDiskPaths
} from './sparkleMainAsarSourceCore'
import { makeTempDir } from './testing/tempDirs'
import { validateSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore'

describe('sparkleMainAsarSourceCore disk collector', () => {
  it('aggregates split chunks on disk like packaged asar', () => {
    const dir = makeTempDir('sparkle-main-out-')
    writeFileSync(path.join(dir, 'index.js'), 'appendAppLog', 'utf8')
    writeFileSync(
      path.join(dir, 'coreReadinessGate-abc.js'),
      '[CoreReadiness]: runCoreReadinessPipeline',
      'utf8'
    )

    assert.equal(listSparkleMainProcessJsDiskPaths(dir).length, 2)
    const source = collectSparkleMainProcessDiskSource(dir)
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })
})
