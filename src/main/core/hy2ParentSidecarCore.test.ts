import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HY2_PARENT_SIDECAR_DIAL_AGE_MS,
  resolveHy2ParentSidecarDialPlan,
} from './hy2ParentSidecarCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

describe('hy2ParentSidecarCore R-35a', () => {
  const baseSnapshot: TransportLongevityTruthSnapshot = {
    schemaVersion: 1,
    updatedAtMs: 1_000_000,
    cursorConnectionCount: 33,
    httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    outboundHy2SessionAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    maxByteStallMs: 0,
    frozenQuicCursorCount: 0,
    activeHy2Leaf: 'KR-VPS-HY2',
  }

  it('triggers sidecar dial when marathon active and session aged', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: true,
      lastSidecarDialAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'sidecar_dial')
    assert.equal(plan.reason, 'proactive_parent_sidecar_dial')
  })

  it('skips when marathon inactive', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: false,
      lastSidecarDialAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'marathon_inactive')
  })

  it('triggers sidecar dial when HTTP parent chain aged even if outbound session is young', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: {
        ...baseSnapshot,
        outboundHy2SessionAgeMs: 60_000,
        httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
      },
      marathonTruthActive: true,
      lastSidecarDialAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'sidecar_dial')
  })

  it('respects sidecar cooldown', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: true,
      lastSidecarDialAtMs: 1_000_000 - 60_000,
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'sidecar_cooldown')
  })

  it('1.30.19: marathon global byte-death bypasses sidecar cooldown', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: {
        ...baseSnapshot,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        maxByteStallMs: 144_500,
        frozenQuicCursorCount: 2,
      },
      marathonTruthActive: true,
      lastSidecarDialAtMs: 1_000_000 - 60_000,
      nowMs: 1_000_000,
      marathonGlobalByteDeath: true,
    })
    assert.equal(plan.action, 'sidecar_dial')
    assert.equal(plan.reason, 'emergency_stall_escalation_r1')
  })

  it('1.30.54: dial failure cluster bypasses age gate and cooldown', () => {
    const nowMs = 2_000_000_000
    const birthMs = nowMs - HY2_PARENT_SIDECAR_DIAL_AGE_MS - 60_000
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: {
        ...baseSnapshot,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        hy2ParentChainBirthMs: birthMs,
      },
      marathonTruthActive: true,
      lastSidecarDialAtMs: nowMs - 60_000,
      nowMs,
      dialFailureClusterEscalation: true,
    })
    assert.equal(plan.action, 'sidecar_dial')
    assert.equal(plan.reason, 'cursor_dedicated_dial_failure_cluster')
  })

  it('1.30.54: effective age from birth triggers sidecar when snapshot ages are zero', () => {
    const nowMs = 2_000_000_000
    const birthMs = nowMs - HY2_PARENT_SIDECAR_DIAL_AGE_MS - 60_000
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: {
        ...baseSnapshot,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        hy2ParentChainBirthMs: birthMs,
      },
      marathonTruthActive: true,
      lastSidecarDialAtMs: 0,
      nowMs,
    })
    assert.equal(plan.action, 'sidecar_dial')
  })

  it('BUG-013: emergency stall escalation bypasses sidecar cooldown', () => {
    const plan = resolveHy2ParentSidecarDialPlan({
      snapshot: baseSnapshot,
      marathonTruthActive: true,
      lastSidecarDialAtMs: 1_000_000 - 60_000,
      nowMs: 1_000_000,
      emergencyStallEscalation: true,
    })
    assert.equal(plan.action, 'sidecar_dial')
    assert.equal(plan.reason, 'emergency_stall_escalation_r1')
  })
})
