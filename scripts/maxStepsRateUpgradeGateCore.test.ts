import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateMaxStepsRateUpgradeGate } from './maxStepsRateUpgradeGateCore'

describe('maxStepsRateUpgradeGateCore R-35c', () => {
  it('allows upgrade when sample insufficient', () => {
    const result = evaluateMaxStepsRateUpgradeGate({
      maxStepsLogLine: '[MaxStepsRate]: attempts_started=3 attempt_rate_pct=0.0 below_target_attempt=1',
      snapshotAttemptRatePct: null,
    })
    assert.equal(result.allowUpgrade, true)
    assert.match(result.reason, /insufficient/)
  })

  it('blocks upgrade when attempt rate below 90%', () => {
    const result = evaluateMaxStepsRateUpgradeGate({
      maxStepsLogLine:
        '[MaxStepsRate]: attempts_started=100 attempts_early_disconnect=15 attempt_rate_pct=85.0 below_target_attempt=1',
      snapshotAttemptRatePct: null,
    })
    assert.equal(result.allowUpgrade, false)
    assert.match(result.reason, /below target/)
  })

  it('allows upgrade when attempt rate meets target', () => {
    const result = evaluateMaxStepsRateUpgradeGate({
      maxStepsLogLine:
        '[MaxStepsRate]: attempts_started=100 attempts_early_disconnect=10 attempt_rate_pct=90.0 below_target_attempt=0',
      snapshotAttemptRatePct: null,
    })
    assert.equal(result.allowUpgrade, true)
    assert.equal(result.reason, 'attempt_slo_gate_pass')
  })
})
