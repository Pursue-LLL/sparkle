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

  it('R-35b closes carrier at 47s stall with registry gap proof', () => {
    const plan = resolveFrozenSurgicalPrunePlan({
      observation: {
        ...baseObservation,
        stallMs: 47_000,
        host: 'api2direct.cursor.sh',
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
      marathonActive: true,
      registryMaxGapSinceActivityMs: 20_000,
    })
    assert.equal(plan.action, 'close_frozen_connection')
    assert.equal(plan.reason, 'marathon_sse_carrier_frozen_prune')
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
