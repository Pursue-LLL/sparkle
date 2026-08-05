import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  STALL_ESCALATION_VITALITY_INEFFECTIVE_MS,
  isVitalityIneffectiveForConnection,
  markStallEscalationExecuted,
  recordVitalityByteSnapshot,
  resetStallEscalationLadderStateForTests,
  resolveCriticalHostCloseDenialPlan,
  resolveStallEscalationLadderPlan
} from './stallEscalationLadderCore'

describe('stallEscalationLadderCore R-41', () => {
  const f1ee553dObservation = {
    kind: 'single' as const,
    connectionId: 'f1ee553d-5cb7-4db4-80bc-84489bff9acb',
    host: 'api2.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 88_499,
    connAgeMs: 93_498,
    frozenQuicCursorCount: 1,
    totalQuicCursorCount: 13,
    cursorConnectionCount: 28
  }

  it('denies close plan for critical api2 host', () => {
    const denial = resolveCriticalHostCloseDenialPlan('api2.cursor.sh')
    assert.ok(denial)
    assert.equal(denial.reason, 'r41_critical_host_no_close')
  })

  it('never escalates an unbound idle connection', () => {
    const plan = resolveStallEscalationLadderPlan({
      observation: f1ee553dObservation,
      upload: 2458,
      download: 4972,
      nowMs: 1_000_000,
      requestBoundStallProof: false
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_request_bound_stall_proof')
  })

  it('f1ee553d replay: 88s stall before emergency threshold', () => {
    resetStallEscalationLadderStateForTests()
    const nowMs = 1_000_000
    recordVitalityByteSnapshot({
      connectionId: f1ee553dObservation.connectionId,
      upload: 2458,
      download: 4972,
      nowMs: nowMs - STALL_ESCALATION_VITALITY_INEFFECTIVE_MS - 1
    })
    assert.equal(
      isVitalityIneffectiveForConnection({
        connectionId: f1ee553dObservation.connectionId,
        upload: 2458,
        download: 4972,
        nowMs
      }),
      true
    )
    const plan = resolveStallEscalationLadderPlan({
      observation: f1ee553dObservation,
      upload: 2458,
      download: 4972,
      nowMs,
      requestBoundStallProof: true
    })
    assert.equal(plan.action, 'emergency_sidecar_dial')
    assert.equal(plan.reason, 'emergency_stall_escalation_r1')
  })

  it('209s stall escalates to parent UDP refresh rung', () => {
    resetStallEscalationLadderStateForTests()
    const nowMs = 2_000_000
    recordVitalityByteSnapshot({
      connectionId: f1ee553dObservation.connectionId,
      upload: 2458,
      download: 4972,
      nowMs: nowMs - 300_000
    })
    const plan = resolveStallEscalationLadderPlan({
      observation: { ...f1ee553dObservation, stallMs: 209_996 },
      upload: 2458,
      download: 4972,
      nowMs,
      requestBoundStallProof: true
    })
    assert.equal(plan.action, 'parent_udp_refresh')
    assert.equal(plan.reason, 'emergency_stall_escalation_r2')
  })

  it('1.30.18: global max_byte_stall escalates R2 when per-conn stallMs below 90s', () => {
    resetStallEscalationLadderStateForTests()
    const nowMs = 2_000_000
    recordVitalityByteSnapshot({
      connectionId: f1ee553dObservation.connectionId,
      upload: 2458,
      download: 4972,
      nowMs: nowMs - STALL_ESCALATION_VITALITY_INEFFECTIVE_MS - 1_000,
    })
    const plan = resolveStallEscalationLadderPlan({
      observation: f1ee553dObservation,
      upload: 2458,
      download: 4972,
      nowMs,
      requestBoundStallProof: true,
      marathonGlobalByteDeath: true,
      globalMaxByteStallMs: 144_500,
    })
    assert.equal(plan.action, 'parent_udp_refresh')
    assert.equal(plan.reason, 'emergency_stall_escalation_r2')
  })

  it('1.30.14: marathon global byte-death bypasses R2 emergency cooldown', () => {
    resetStallEscalationLadderStateForTests()
    const nowMs = 2_000_000
    const connectionId = f1ee553dObservation.connectionId
    recordVitalityByteSnapshot({
      connectionId,
      upload: 2458,
      download: 4972,
      nowMs: nowMs - 300_000,
    })
    markStallEscalationExecuted({
      connectionId,
      action: 'emergency_sidecar_dial',
      nowMs: nowMs - 30_000,
    })
    const plan = resolveStallEscalationLadderPlan({
      observation: { ...f1ee553dObservation, stallMs: 209_996 },
      upload: 2458,
      download: 4972,
      nowMs,
      requestBoundStallProof: true,
      marathonGlobalByteDeath: true,
    })
    assert.equal(plan.action, 'parent_udp_refresh')
  })
})
