import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS,
  resolveFrozenSurgicalPrunePlan
} from './frozenSurgicalPruneCore'
import { MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS } from './mihomoQuicSilentStallRecoveryCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'

describe('frozenSurgicalPruneCore R-34c + R-41', () => {
  const baseObservation = {
    kind: 'single' as const,
    connectionId: 'conn-frozen-1',
    host: 'api2direct.cursor.sh',
    leaf: 'KR-VPS-HY2',
    network: 'tcp',
    stallMs: 130_000,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 3,
    totalQuicCursorCount: 10,
    cursorConnectionCount: 33
  }

  it('Sep2 replay: 84s frozen_quic marathon tier0 SEL vitality (not zero_data_plane dead-end)', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 84_003,
        frozenQuicCursorCount: 1,
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      staleRequestIds: [],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      httpParentChainAgeMs: 81_656_460,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'marathon_tier0_frozen_quic_cluster_sel')
    assert.equal(plan.staleProofKind, 'frozen_quic_cluster')
  })

  it('R-41: never closes critical host on legacy frozen_surgical_prune path', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 2,
      staleRequestIds: ['rid-active'],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
  })

  it('1.30.12: marathon parent recovery bypasses token_gap when frozen_quic cluster', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        host: 'api2.cursor.sh',
        stallMs: 144_500,
        frozenQuicCursorCount: 2,
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      staleRequestIds: [],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registry: { records: new Map() },
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
    assert.equal(plan.staleProofKind, 'absolute_byte_stall')
  })

  it('does not close without token gap stale proof when marathon inactive', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })

  it('keeps a proven critical carrier open during global prune cooldown', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: baseObservation,
      tokenGapMaxMs: 60_000,
      staleRequestIdCount: 1,
      staleRequestIds: ['rid-active'],
      lastGlobalPruneAtMs: 1_000_000 - FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS + 1_000,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
  })

  it('R-41: carrier token_gap stale on critical host → vitality not close', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: { ...baseObservation, stallMs: 90_000 },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 5_000,
      staleRequestIdCount: 1,
      staleRequestIds: ['9480ace0-4dfd-4bf5-99e0-0f9ee5639d67'],
      lastGlobalPruneAtMs: 1_000_000 - FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS + 1_000,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registry: { records: new Map() }
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
    assert.equal(plan.carrierRid, '9480ace0-4dfd-4bf5-99e0-0f9ee5639d67')
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
      registryMaxGapSinceActivityMs: 0
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })

  it('P10-2: marathon parent recovery allows carrier path without token_gap list', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: { ...baseObservation, stallMs: 95_000 },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 2,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registry: { records: new Map() }
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
    assert.ok(plan.staleProofKind === 'absolute_byte_stall' || plan.staleProofKind === 'token_gap')
  })

  it('R-41: registry_gap carrier on critical host → SEL vitality not close', () => {
    const nowMs = 1_000_000
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 47_000,
        host: 'api2direct.cursor.sh'
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
              openToolCalls: 0
            }
          ]
        ])
      }
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'r41_critical_host_carrier_no_close')
    assert.equal(plan.staleProofKind, 'registry_gap')
  })

  it('f1ee553d replay: 8/4 api2.cursor.sh never close at 209s', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        kind: 'single',
        connectionId: 'f1ee553d-5cb7-4db4-80bc-84489bff9acb',
        host: 'api2.cursor.sh',
        leaf: 'KR-VPS-HY2',
        network: 'tcp',
        stallMs: 208_996,
        connAgeMs: 213_995,
        frozenQuicCursorCount: 1,
        totalQuicCursorCount: 11,
        cursorConnectionCount: 27
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 50_000,
      staleRequestIdCount: 2,
      staleRequestIds: ['5f587792-788d-4188-a82c-913e1464a5f5'],
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: false
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })
})
