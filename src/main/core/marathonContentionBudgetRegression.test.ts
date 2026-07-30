import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS,
  buildMarathonContentionBreachKinds,
  evaluateMarathonContentionBudget,
} from './marathonContentionBudgetCore'
import { HUNG_SCAN_INTERVAL_MS } from './cursorTransportHealthCore'

/**
 * Regression: 07:06 TLS window — token_gap rescue must not bypass green cap via routine breach.
 * Simulates 4 hung_scan cycles (15s) after one executed triple-pulse on green baseline.
 */
describe('marathonContentionBudgetRegression R-24', () => {
  const greenDelayMs = 291
  const baseMs = 1_700_000_000_000

  it('denies rescue-bundle pulse on cycles 2-4 when only routine token_gap would have fired', () => {
    const lastObservabilityDialAtMs = baseMs
    const rescueBreachKinds = buildMarathonContentionBreachKinds(
      {
        pulseContractBreach: false,
        connectPathPartitionDetected: false,
        connectPartitionPresent: false,
        latencyDeltaRescueEligible: false,
        silentGenerationEndPresent: false,
        coldResumePresent: false,
        tokenGapRescueIneffective: false,
        connectPartitionRescueIneffective: false,
        frozenQuicCursorCount: 0,
      },
      { forIndependentPulse: false },
    )
    assert.deepEqual(rescueBreachKinds, [])

    let denyCount = 0
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      const nowMs = baseMs + cycle * HUNG_SCAN_INTERVAL_MS
      const decision = evaluateMarathonContentionBudget({
        nowMs,
        lastAuthoritativeConnectPathDelayMs: greenDelayMs,
        lastObservabilityDialAtMs,
        breachKinds: rescueBreachKinds,
        independentPulse: false,
        dialTrigger: 'token_gap',
      })
      if (decision.outcome === 'deny') {
        denyCount += 1
      }
    }
    assert.equal(denyCount, 4)
  })

  it('allows independent pulse when pulse_contract_breach and cap inside 300s window', () => {
    const rescueBreachKinds = buildMarathonContentionBreachKinds(
      {
        pulseContractBreach: true,
        connectPathPartitionDetected: false,
        connectPartitionPresent: false,
        latencyDeltaRescueEligible: false,
        silentGenerationEndPresent: false,
        coldResumePresent: false,
        tokenGapRescueIneffective: false,
        connectPartitionRescueIneffective: false,
        frozenQuicCursorCount: 0,
      },
      { forIndependentPulse: true },
    )
    const decision = evaluateMarathonContentionBudget({
      nowMs: baseMs + 90_000,
      lastAuthoritativeConnectPathDelayMs: greenDelayMs,
      lastObservabilityDialAtMs: baseMs,
      breachKinds: rescueBreachKinds,
      independentPulse: true,
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'breach')
    }
  })

  it('allows rescue pulse after green cap elapsed', () => {
    const decision = evaluateMarathonContentionBudget({
      nowMs: baseMs + MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS + 1,
      lastAuthoritativeConnectPathDelayMs: greenDelayMs,
      lastObservabilityDialAtMs: baseMs,
      breachKinds: [],
      independentPulse: false,
      dialTrigger: 'token_gap',
    })
    assert.equal(decision.outcome, 'allow')
    if (decision.outcome === 'allow') {
      assert.equal(decision.reason, 'cap_elapsed')
    }
  })
})
