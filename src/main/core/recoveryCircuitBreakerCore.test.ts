import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInitialRecoveryCircuitBreakerState,
  isRecoveryCircuitOpen,
  recordRecoveryFailure,
  recordRecoverySuccess,
  RECOVERY_CIRCUIT_BREAKER_COOLDOWN_MS,
  RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from './recoveryCircuitBreakerCore'

describe('recoveryCircuitBreakerCore P1', () => {
  it('opens after threshold consecutive failures', () => {
    const t0 = 1_700_000_000_000
    let state = createInitialRecoveryCircuitBreakerState()
    for (let index = 1; index < RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD; index += 1) {
      const step = recordRecoveryFailure({
        nowMs: t0 + index * 1000,
        state,
        reason: 'sidecar_dial_failed',
      })
      state = step.state
      assert.equal(step.opened, false)
    }
    const opened = recordRecoveryFailure({
      nowMs: t0 + 4000,
      state,
      reason: 'emergency_stall_escalation_r1',
    })
    assert.equal(opened.opened, true)
    assert.equal(opened.state.consecutiveFailures, RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD)
    assert.equal(
      opened.state.openUntilMs,
      t0 + 4000 + RECOVERY_CIRCUIT_BREAKER_COOLDOWN_MS,
    )
    assert.equal(
      isRecoveryCircuitOpen({ nowMs: t0 + 5000, state: opened.state }),
      true,
    )
  })

  it('success resets consecutive failures and closes circuit', () => {
    let state = createInitialRecoveryCircuitBreakerState()
    const failed = recordRecoveryFailure({
      nowMs: 1000,
      state,
      reason: 'sidecar_dial_failed',
    })
    state = failed.state
    state = recordRecoverySuccess(state)
    assert.equal(state.consecutiveFailures, 0)
    assert.equal(state.openUntilMs, 0)
  })

  it('replays 2026-08-31 16:30 sidecar fail loop — circuit opens before minute 2', () => {
    const t0 = Date.parse('2026-08-31T08:30:03.255Z')
    let state = createInitialRecoveryCircuitBreakerState()
    const failureTimes = [0, 5000, 15000, 20000, 25000, 30000, 35000]
    let openedAtMs: number | undefined
    for (const offsetMs of failureTimes) {
      const step = recordRecoveryFailure({
        nowMs: t0 + offsetMs,
        state,
        reason: 'emergency_stall_escalation_r1',
      })
      state = step.state
      if (step.opened) {
        openedAtMs = t0 + offsetMs
        break
      }
    }
    assert.ok(openedAtMs != null)
    assert.ok(openedAtMs <= t0 + 20_000)
    assert.equal(
      isRecoveryCircuitOpen({ nowMs: openedAtMs + 1000, state }),
      true,
    )
  })
})
