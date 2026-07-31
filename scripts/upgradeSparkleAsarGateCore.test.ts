import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSparkleMainAsarBundle,
  validateSparkleMainAsarBundle,
} from './upgradeSparkleAsarGateCore'

describe('upgradeSparkleAsarGateCore', () => {
  it('accepts linked networkStartupGraceCore.markCoreReadyAtMs call with R-34 close wiring', () => {
    const source = `
      require_log.appendAppLog("x");
      require_networkStartupGraceCore.markCoreReadyAtMs();
      frozen_surgical_prune close_frozen_connection mihomoCloseConnection maxStepsRateObserver attempt_rate_pct below_target_attempt
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
    const result = validateSparkleMainAsarBundle(
      'markCoreReadyAtMs(); frozen_surgical_prune mihomoCloseConnection',
    )
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'stale_bundle')
  })

  it('rejects marathon_block_close_connection regression', () => {
    const source =
      'appendAppLog frozen_surgical_prune mihomoCloseConnection .markCoreReadyAtMs( marathon_block_close_connection'
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'regression_marathon_block_close')
  })

  it('accepts minified .markCoreReadyAtMs( pattern from Vite chunk export', () => {
    const source =
      'foo.markCoreReadyAtMs(); require_log.appendAppLog("x"); frozen_surgical_prune mihomoCloseConnection attempt_rate_pct'
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('accepts R-34 markers in code-split chunk when index.js lacks them', () => {
    const indexChunk =
      'require_log.appendAppLog("x"); require_networkStartupGraceCore.markCoreReadyAtMs(); mihomoCloseConnection'
    const stallChunk = 'close_frozen_connection frozen_surgical_prune maxStepsRateObserver attempt_rate_pct below_target_attempt'
    const source = `${indexChunk}\n${stallChunk}`
    assert.deepEqual(validateSparkleMainAsarBundle(source), { ok: true })
  })

  it('rejects bundle missing P28b attempt SLO markers', () => {
    const source =
      'appendAppLog .markCoreReadyAtMs( frozen_surgical_prune mihomoCloseConnection maxStepsRateObserver'
    const result = validateSparkleMainAsarBundle(source)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.equal(result.reason, 'missing_p28b_attempt_rate')
  })
})
