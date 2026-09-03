import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CARRIER_QUIESCE_BYTE_FROZEN_MS,
  PARENT_EMERGENCY_REFRESH_AGE_MS,
  resolveCarrierQuiesceRefreshDecision,
} from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

function snapshot(
  overrides: Partial<TransportLongevityTruthSnapshot> = {},
): TransportLongevityTruthSnapshot {
  const nowMs = Date.now()
  const httpAge = overrides.httpParentChainAgeMs ?? HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1
  const outboundAge = overrides.outboundHy2SessionAgeMs ?? HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1
  const maxAge = Math.max(httpAge, outboundAge)
  return {
    schemaVersion: 2,
    updatedAtMs: nowMs,
    cursorConnectionCount: 20,
    httpParentChainAgeMs: httpAge,
    outboundHy2SessionAgeMs: outboundAge,
    maxByteStallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 1,
    frozenQuicCursorCount: 2,
    activeHy2Leaf: 'JP-VPS-HY2',
    hy2ParentChainBirthMs: overrides.hy2ParentChainBirthMs ?? nowMs - maxAge,
    ...overrides,
  }
}

describe('carrierQuiesceRefreshCore Phase B', () => {
  it('bypasses active_inner when parent stale and carrier byte-frozen', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot(),
      activeInnerCriticalCount: 15,
      recoveryIneffective: false,
    })
    assert.equal(decision.bypassActiveInner, true)
    assert.equal(decision.reason, 'carrier_quiesce_refresh_bypass_active_inner')
  })

  it('blocks bypass when parent is young and marathon inactive', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: 60_000,
        outboundHy2SessionAgeMs: 60_000,
      }),
      activeInnerCriticalCount: 15,
      recoveryIneffective: true,
      marathonActive: false,
    })
    assert.equal(decision.bypassActiveInner, false)
    assert.equal(decision.reason, 'parent_not_refresh_due')
  })

  it('1.30.13: marathon global byte-death bypasses active_inner when parent is young', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: 2_610_790,
        outboundHy2SessionAgeMs: 2_610_790,
        maxByteStallMs: 144_500,
        frozenQuicCursorCount: 2,
      }),
      activeInnerCriticalCount: 15,
      recoveryIneffective: true,
      marathonActive: true,
    })
    assert.equal(decision.bypassActiveInner, true)
    assert.equal(decision.reason, 'marathon_global_byte_death_bypass_active_inner')
  })

  it('1.30.13: marathon byte-death requires absolute stall threshold', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: 2_610_790,
        outboundHy2SessionAgeMs: 2_610_790,
        maxByteStallMs: MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS - 1,
        frozenQuicCursorCount: 2,
      }),
      activeInnerCriticalCount: 15,
      recoveryIneffective: true,
      marathonActive: true,
    })
    assert.equal(decision.bypassActiveInner, false)
    assert.equal(decision.reason, 'parent_not_refresh_due')
  })

  it('blocks bypass when carrier is not byte-frozen', () => {
    const nowMs = Date.now()
    const youngAge = 60_000
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: youngAge,
        outboundHy2SessionAgeMs: youngAge,
        hy2ParentChainBirthMs: nowMs - youngAge,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
      }),
      activeInnerCriticalCount: 12,
      recoveryIneffective: true,
      nowMs,
    })
    assert.equal(decision.bypassActiveInner, false)
    assert.equal(decision.reason, 'carrier_not_byte_frozen')
  })

  it('bypasses active_inner when parent is emergency stale (8h+)', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: PARENT_EMERGENCY_REFRESH_AGE_MS + 1,
        outboundHy2SessionAgeMs: PARENT_EMERGENCY_REFRESH_AGE_MS + 1,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
      }),
      activeInnerCriticalCount: 20,
      recoveryIneffective: false,
    })
    assert.equal(decision.bypassActiveInner, true)
    assert.equal(decision.reason, 'parent_emergency_refresh_bypass_active_inner')
  })

  it('1.30.55: emergency refresh uses birth when snapshot ages are zero', () => {
    const nowMs = 2_000_000_000
    const birthMs = nowMs - PARENT_EMERGENCY_REFRESH_AGE_MS - 60_000
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        hy2ParentChainBirthMs: birthMs,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
      }),
      activeInnerCriticalCount: 20,
      recoveryIneffective: false,
      nowMs,
    })
    assert.equal(decision.bypassActiveInner, true)
    assert.equal(decision.reason, 'parent_emergency_refresh_bypass_active_inner')
  })
})
