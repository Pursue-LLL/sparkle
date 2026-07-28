import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSparkleMainAsarBundle,
  validateSparkleMainAsarBundle,
} from './upgradeSparkleAsarGateCore'

describe('upgradeSparkleAsarGateCore', () => {
  it('accepts linked networkStartupGraceCore.markCoreReadyAtMs call', () => {
    const source = `
      require_log.appendAppLog("x");
      require_networkStartupGraceCore.markCoreReadyAtMs();
    `
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
    assert.doesNotThrow(() => assertSparkleMainAsarBundle(source))
  })

  it('rejects bare markCoreReadyAtMs() without chunk prefix (BUG-2026-07-23-004 regression)', () => {
    const broken = `
      require_log.appendAppLog("x");
      markCoreReadyAtMs();
    `
    const result = validateSparkleMainAsarBundle(broken)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_mark_core_ready_call')
  })

  it('rejects stale bundle missing appendAppLog', () => {
    const result = validateSparkleMainAsarBundle('markCoreReadyAtMs();')
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'stale_bundle')
  })

  it('accepts minified .markCoreReadyAtMs( pattern from Vite chunk export', () => {
    const source = 'foo.markCoreReadyAtMs(); require_log.appendAppLog("x");'
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })
})
