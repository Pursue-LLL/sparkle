import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
} from './hy2ParentByteDeathRecoveryCore'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
} from './emergencyCoreRecoveryCore'

describe('emergencyCoreRecoveryCore @phase1', () => {
  it('admits confirmed udp absent with drain when cursor_conn > 0', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'JP-VPS-HY2',
        evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: 42,
        requestedAtMs,
        deadlineMs: buildEmergencyCoreRecoveryDeadline(requestedAtMs),
      },
    })
    assert.equal(admission.admitted, true)
    assert.equal(admission.drainMs, 15_000)
  })

  it('rejects unknown evidence', () => {
    const requestedAtMs = 1_000_000
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      nowMs: requestedAtMs + 1_000,
      request: {
        reason: 'confirmed_udp_parent_absent',
        leafId: 'JP-VPS-HY2',
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
        leafId: 'JP-VPS-HY2',
        evidenceReason: 'recovery_circuit_breaker_open',
        cursorConnectionCount: 10,
        requestedAtMs,
        deadlineMs,
      },
    })
    assert.equal(admission.admitted, false)
    assert.equal(admission.reason, 'emergency_deadline_expired')
  })
})
