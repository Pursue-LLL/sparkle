import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CARRIER_QUIESCE_BYTE_FROZEN_MS,
  resolveCarrierQuiesceRefreshDecision,
} from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

function snapshot(
  overrides: Partial<TransportLongevityTruthSnapshot> = {},
): TransportLongevityTruthSnapshot {
  return {
    schemaVersion: 2,
    updatedAtMs: Date.now(),
    cursorConnectionCount: 20,
    httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    outboundHy2SessionAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    maxByteStallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 1,
    frozenQuicCursorCount: 2,
    activeHy2Leaf: 'JP-VPS-HY2',
    hy2ParentChainBirthMs: 1,
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

  it('blocks bypass when parent is young', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        httpParentChainAgeMs: 60_000,
        outboundHy2SessionAgeMs: 60_000,
      }),
      activeInnerCriticalCount: 15,
      recoveryIneffective: true,
    })
    assert.equal(decision.bypassActiveInner, false)
    assert.equal(decision.reason, 'parent_not_refresh_due')
  })

  it('blocks bypass when carrier is not byte-frozen', () => {
    const decision = resolveCarrierQuiesceRefreshDecision({
      snapshot: snapshot({
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
      }),
      activeInnerCriticalCount: 12,
      recoveryIneffective: true,
    })
    assert.equal(decision.bypassActiveInner, false)
    assert.equal(decision.reason, 'carrier_not_byte_frozen')
  })
})
