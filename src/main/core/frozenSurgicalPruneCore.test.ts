import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS,
  resolveFrozenSurgicalPrunePlan,
} from './frozenSurgicalPruneCore'
import { MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS } from './mihomoQuicSilentStallRecoveryCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'

describe('frozenSurgicalPruneCore R-34c', () => {
  const baseObservation = {
    kind: 'single' as const,
    connectionId: 'conn-frozen-1',
    host: 'api2direct.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 130_000,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 3,
    totalQuicCursorCount: 10,
    cursorConnectionCount: 33,
  }

  it('closes frozen connection when all gates pass during marathon', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 2,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'frozen_surgical_prune')
  })

  it('does not close without token gap stale proof (zero mis-kill)', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'no_token_gap_stale_proof')
  })

  it('respects global prune cooldown', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: 60_000,
      staleRequestIdCount: 1,
      lastGlobalPruneAtMs: 1_000_000 - FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS + 1_000,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'global_prune_cooldown')
  })

  it('R-38: carrier token_gap stale bypasses global prune cooldown', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: { ...baseObservation, stallMs: 90_000 },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 5_000,
      staleRequestIdCount: 1,
      staleRequestIds: ['9480ace0-4dfd-4bf5-99e0-0f9ee5639d67'],
      lastGlobalPruneAtMs: 1_000_000 - FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS + 1_000,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'marathon_sse_carrier_frozen_prune')
  })

  it('requires stall above close threshold for legacy 120s path', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: { ...baseObservation, stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS - 1 },
      tokenGapMaxMs: 60_000,
      staleRequestIdCount: 1,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: false,
      registryMaxGapSinceActivityMs: 0,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'single_stall_vitality')
  })

  it('P10-2 blocks legacy generic prune while marathon active (carrier path exempt)', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: { ...baseObservation, stallMs: 85_000 },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 2,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'marathon_active_zero_data_plane_mutation')
  })

  it('R-35b carrier prune allowed during marathon when registry proves stale SSE', () => {
    const nowMs = 1_000_000
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 47_000,
        host: 'api2direct.cursor.sh',
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      staleRequestIds: [],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs,
      marathonActive: true,
      registryMaxGapSinceActivityMs: 20_000,
      registry: {
        records: new Map([
          [
            'req-a',
            {
              requestId: 'req-a',
              originalRequestId: 'rid-carrier',
              firstActivityMs: 900_000,
              lastActivityMs: nowMs - 20_000,
              openToolCalls: 0,
            },
          ],
        ]),
      },
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'marathon_sse_carrier_frozen_prune')
    assert.equal(plan.carrierRid, 'rid-carrier')
    assert.equal(plan.staleProofKind, 'registry_gap')
  })

  it('9480ace0-class: token_gap stale during marathon closes carrier conn not legacy path', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 47_000,
        host: 'api2direct.cursor.sh',
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 1,
      staleRequestIds: ['9480ace0-4dfd-4bf5-99e0-0f9ee5639d67'],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registryMaxGapSinceActivityMs: 0,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'marathon_sse_carrier_frozen_prune')
    assert.equal(plan.carrierRid, '9480ace0-4dfd-4bf5-99e0-0f9ee5639d67')
    assert.equal(plan.staleProofKind, 'token_gap')
  })

  it('9480ace0 replay: token_gap stale with marathonTruth false prefers carrier over legacy prune', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 210_995,
        host: 'api2.cursor.sh',
        connectionId: 'c8ed1237-a515-41c3-b4ed-5b0c92eb6e86',
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 50_000,
      staleRequestIdCount: 2,
      staleRequestIds: ['9480ace0-4dfd-4bf5-99e0-0f9ee5639d67', 'e7b65ffd-607b-4d59-b48e-1e2776005364'],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: false,
      registryMaxGapSinceActivityMs: 0,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'marathon_sse_carrier_frozen_prune')
    assert.equal(plan.carrierRid, '9480ace0-4dfd-4bf5-99e0-0f9ee5639d67')
  })

  it('07-31 stall_ms=213944 replay closes frozen connection under R-34 five-gate AND', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        kind: 'single',
        connectionId: 'conn-0731-replay',
        host: 'api2.cursor.sh',
        leaf: 'JP-VPS-HY2',
        network: 'tcp',
        stallMs: 213_944,
        connAgeMs: 400_000,
        frozenQuicCursorCount: 2,
        totalQuicCursorCount: 8,
        cursorConnectionCount: 33,
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 5_000,
      staleRequestIdCount: 1,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'frozen_surgical_prune')
  })
})
