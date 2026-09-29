import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
} from './hy2ParentByteDeathRecoveryCore'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
  evaluateEmergencyCoreRecoveryCooldown,
  EMERGENCY_CORE_RECOVERY_COOLDOWN_MS,
} from './emergencyCoreRecoveryCore'

describe('emergencyCoreRecoveryCore @phase1', () => {
  it('admits confirmed udp absent with drain when cursor_conn > 0', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      stackDeadlockConfirmed: true,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'KR-VPS-HY2',
        evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: 42,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, true)
    assert.equal(admission.drainMs, 15_000)
  })

  it('BUG-016: rejects admission without proxy-stack deadlock confirmation', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'KR-VPS-HY2',
        evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: 42,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'proxy_stack_not_confirmed_deadlock')
  })

  it('rejects unknown evidence', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'KR-VPS-HY2',
        evidenceReason: 'random_reason',
        cursorConnectionCount: 0,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'emergency_evidence_not_allowed')
  })

  it('rejects expired deadline', () => {
    const requestedAtMs = 1_000_000
    const deadlineMs = buildEmergencyCoreRecoveryDeadline(requestedAtMs)
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: deadlineMs + 1,
      request: {
        reason: 'byte_death_circuit_open',
        leafId: 'KR-VPS-HY2',
        evidenceReason: 'recovery_circuit_breaker_open',
        cursorConnectionCount: 10,
        requestedAtMs,
        deadlineMs,
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'emergency_deadline_expired')
  })

  it('rejects in-flight duplicate admission', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      inFlight: true,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'KR-VPS-HY2',
        evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: 42,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'emergency_recovery_in_flight')
  })

  it('rejects admission during cooldown window', () => {
    const requestedAtMs = 1_000_000
    const lastCompletedAtMs = requestedAtMs
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + EMERGENCY_CORE_RECOVERY_COOLDOWN_MS - 1,
      lastCompletedAtMs,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'KR-VPS-HY2',
        evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: 42,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'emergency_cooldown_active')
  })

  it('cooldown clears after window', () => {
    const nowMs = 2_000_000
    const cooldown = evaluateEmergencyCoreRecoveryCooldown({
      nowMs,
      lastCompletedAtMs: nowMs - EMERGENCY_CORE_RECOVERY_COOLDOWN_MS,
    })
    assert.equal(cooldown.blocked, false)
  })

  it('BUG-013: bypass cooldown when prior readiness api2 was not verified', () => {
    const nowMs = 2_000_000
    const cooldown = evaluateEmergencyCoreRecoveryCooldown({
      nowMs: nowMs + 30_000,
      lastCompletedAtMs: nowMs,
      lastReadinessApi2Verified: false,
    })
    assert.equal(cooldown.blocked, false)
    assert.equal(cooldown.reason, 'emergency_cooldown_bypass_unverified_readiness')
  })

})
