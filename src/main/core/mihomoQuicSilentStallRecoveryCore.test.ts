import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS,
  resolveMihomoQuicStallRecoveryPlan,
} from './mihomoQuicSilentStallRecoveryCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'

describe('mihomoQuicSilentStallRecoveryCore R-34', () => {
  const baseObservation = {
    kind: 'single' as const,
    connectionId: 'conn-stall-1',
    host: 'api2direct.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 50_000,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 3,
    totalQuicCursorCount: 10,
    cursorConnectionCount: 33,
  }

  it('plans vitality dial for single stall below close threshold', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: baseObservation,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'single_stall_vitality')
  })

  it('plans close for frozen surgical prune when token gap proves stale', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1,
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 1,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'close_connection')
    assert.equal(plan.reason, 'frozen_surgical_prune')
  })

  it('blocks close during marathon when no token gap proof', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        cursorConnectionCount: 33,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1,
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'no_token_gap_stale_proof')
  })
})
