import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateG9SoakPass, parseG9SoakMetrics } from './g9SoakMonitorCore'

describe('g9SoakMonitorCore', () => {
  const passLine =
    '[MaxStepsRate]: window=rolling100 rate_pct=90.0 attempts_started=100 attempts_early_disconnect=10 attempt_rate_pct=90.0 below_target_attempt=0'

  it('passes at exactly 90% SLO with non-zero early disconnects', () => {
    const metrics = parseG9SoakMetrics(passLine, null, null)
    assert.equal(metrics.attemptsEarlyDisconnect, 10)
    assert.equal(metrics.attemptRatePct, 90)
    assert.equal(metrics.belowTargetAttempt, false)
    assert.equal(evaluateG9SoakPass(metrics), true)
  })

  it('fails when attempt rate below 90%', () => {
    const line = passLine.replace('attempt_rate_pct=90.0', 'attempt_rate_pct=89.9').replace('below_target_attempt=0', 'below_target_attempt=1')
    const metrics = parseG9SoakMetrics(line, null, null)
    assert.equal(evaluateG9SoakPass(metrics), false)
  })

  it('fails when sample size below minimum attempts', () => {
    const line = passLine.replace('attempts_started=100', 'attempts_started=9')
    const metrics = parseG9SoakMetrics(line, null, null)
    assert.equal(evaluateG9SoakPass(metrics), false)
  })

  it('rejects legacy 100% gate that required zero early disconnects', () => {
    const line =
      '[MaxStepsRate]: attempts_started=100 attempts_early_disconnect=10 attempt_rate_pct=90.0 below_target_attempt=0'
    const metrics = parseG9SoakMetrics(line, null, null)
    assert.equal(metrics.attemptsEarlyDisconnect, 10)
    assert.equal(evaluateG9SoakPass(metrics), true)
  })

  it('falls back to snapshot attempt rate when log line lacks attempt fields', () => {
    const metrics = parseG9SoakMetrics(
      '[MaxStepsRate]: window=rolling100 rate_pct=50.0',
      null,
      92,
    )
    assert.equal(metrics.attemptRatePct, 92)
  })
})
