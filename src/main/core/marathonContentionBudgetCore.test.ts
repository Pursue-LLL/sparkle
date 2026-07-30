import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MARATHON_CONTENTION_GREEN_DELAY_MS,
  MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS,
  evaluateMarathonContentionBudget,
  formatMarathonContentionBudgetLogLine,
  hasMarathonContentionBreach,
  isMarathonConnectPathGreen,
  resolveMarathonContentionCapRemainingMs,
} from './marathonContentionBudgetCore'

describe('marathonContentionBudgetCore', () => {
  const nowMs = 1_000_000_000

  it('isMarathonConnectPathGreen accepts 1..399ms', () => {
    assert.equal(isMarathonConnectPathGreen(291), true)
    assert.equal(isMarathonConnectPathGreen(MARATHON_CONTENTION_GREEN_DELAY_MS - 1), true)
    assert.equal(isMarathonConnectPathGreen(0), false)
    assert.equal(isMarathonConnectPathGreen(613), false)
    assert.equal(isMarathonConnectPathGreen(null), false)
  })

  it('allows first dial when no prior delay sample', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: null,
      lastObservabilityDialAtMs: 0,
      breachKinds: [],
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'no_prior_delay_sample')
    }
  })

  it('denies independent pulse within green cap', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 291,
      lastObservabilityDialAtMs: nowMs - 60_000,
      breachKinds: [],
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'deny')
    if (decision.outcome === 'deny') {
      assert.equal(decision.reason, 'green_cap')
      assert.equal(decision.remainingMs, MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS - 60_000)
    }
  })

  it('allows after green cap elapsed', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 295,
      lastObservabilityDialAtMs: nowMs - MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS,
      breachKinds: [],
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'cap_elapsed')
    }
  })

  it('allows when path not green even inside cap', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 613,
      lastObservabilityDialAtMs: nowMs - 30_000,
      breachKinds: [],
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'path_not_green')
    }
  })

  it('breach bypasses green cap for independent pulse', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 291,
      lastObservabilityDialAtMs: nowMs - 10_000,
      breachKinds: ['pulse_contract_breach'],
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'breach')
    }
  })

  it('breach bypasses green cap for rescue dial trigger', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 291,
      lastObservabilityDialAtMs: nowMs - 10_000,
      breachKinds: ['token_gap'],
      independentPulse: false,
      dialTrigger: 'token_gap',
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'rescue_with_breach')
    }
  })

  it('denies rescue bundle pulse on green path without breach', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs,
      lastAuthoritativeConnectPathDelayMs: 300,
      lastObservabilityDialAtMs: nowMs - 120_000,
      breachKinds: [],
      independentPulse: false,
      dialTrigger: 'token_gap',
    })
    assert.equal(decision.outcome, 'deny')
  })

  it('resolveMarathonContentionCapRemainingMs returns 0 when never dialed', () => {
    assert.equal(resolveMarathonContentionCapRemainingMs(0, nowMs), 0)
  })

  it('hasMarathonContentionBreach reflects non-empty breach list', () => {
    assert.equal(hasMarathonContentionBreach([]), false)
    assert.equal(hasMarathonContentionBreach(['partition_stale_connect_path']), true)
  })

  it('formatMarathonContentionBudgetLogLine includes deny remaining_ms', () => {
    const line = formatMarathonContentionBudgetLogLine(
      { outcome: 'deny', reason: 'green_cap', remainingMs: 240_000 },
      { cursorConnectionCount: 12, independentPulse: true, lastDelayMs: 291 },
    )
    assert.match(line, /\[MarathonContentionBudget\]:/)
    assert.match(line, /remaining_ms=240000/)
    assert.match(line, /last_connect_path_delay_ms=291/)
  })

  it('formatMarathonContentionBudgetLogLine includes allow reason', () => {
    const line = formatMarathonContentionBudgetLogLine(
      { outcome: 'allow', reason: 'breach' },
      { cursorConnectionCount: 14, independentPulse: false, trigger: 'token_gap' },
    )
    assert.match(line, /reason=breach/)
    assert.match(line, /trigger=token_gap/)
  })
})
