import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS,
  MIHOMO_QUIC_STALL_RECOVERY_COOLDOWN_MS,
  resolveMihomoQuicStallRecoveryPlan,
} from './mihomoQuicSilentStallRecoveryCore'

describe('mihomoQuicSilentStallRecoveryCore R-33', () => {
  const baseObservation = {
    kind: 'single' as const,
    connectionId: 'conn-stall-1',
    host: 'api2.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 50_000,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 3,
    totalQuicCursorCount: 10,
    cursorConnectionCount: 20,
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

  it('plans close for single stall above close threshold when not marathon', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        cursorConnectionCount: 8,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1,
      },
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'close_connection')
  })

  it('blocks close_connection during marathon and uses vitality dial instead', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        ...baseObservation,
        cursorConnectionCount: 20,
        stallMs: MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS + 1,
      },
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'marathon_block_close_connection')
  })

  it('respects per-connection recovery cooldown', () => {
    const nowMs = 1_000_000
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: baseObservation,
      lastRecoveryAtMsByConnectionId: new Map([
        ['conn-stall-1', nowMs - MIHOMO_QUIC_STALL_RECOVERY_COOLDOWN_MS + 1_000],
      ]),
      nowMs,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'recovery_cooldown')
  })

  it('plans vitality dial for aggregate frozen window', () => {
    const plan = resolveMihomoQuicStallRecoveryPlan({
      observation: {
        kind: 'aggregate',
        leaf: 'JP-VPS-HY2',
        stallMs: 90_000,
        frozenQuicCursorCount: 8,
        totalQuicCursorCount: 20,
        cursorConnectionCount: 90,
      },
      lastRecoveryAtMsByConnectionId: new Map(),
      nowMs: 1_000_000,
    })
    assert.equal(plan.action, 'vitality_dial')
    assert.equal(plan.reason, 'aggregate_frozen_quic')
  })
})
