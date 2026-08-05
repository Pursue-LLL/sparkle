import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS,
  resolveMihomoQuicStallRecoveryPlan
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
    cursorConnectionCount: 33
  }

  it('does not dial from byte silence without current request-bound proof', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: baseObservation,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })

  it('does not mutate when the legacy wrapper lacks a current request id', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1
      },
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 1,
      lastGlobalPruneAtMs: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })

  it('blocks close during marathon when no token gap proof', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        cursorConnectionCount: 33,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1
      },
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'missing_current_request_bound_stall_proof')
  })
})
