// [INPUT] mihomoQuicSilentStallCore observations
// [OUTPUT] stall recovery gate + log formatter
// [POS] R-33 SSOT — targeted HY2 vitality + single-connection close (no failover, no mass close).

import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'

/** Trigger lightweight connect_path vitality once byte-frozen threshold is met. */
export const MIHOMO_QUIC_STALL_VITALITY_TRIGGER_MS = MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS

/** Close one frozen critical-host flow after this stall duration (Cursor likely dead on this socket). */
export const MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS = 120_000

/** Per-connection recovery cooldown — avoid close/vitality storms on the same id. */
export const MIHOMO_QUIC_STALL_RECOVERY_COOLDOWN_MS = 60_000

export type MihomoQuicStallRecoveryAction = 'none' | 'vitality_dial' | 'close_connection'

export interface MihomoQuicStallRecoveryPlan {
  action: MihomoQuicStallRecoveryAction
  reason: string
}

export function resolveMihomoQuicStallRecoveryPlan(input: {
  observation: MihomoQuicSilentStallObservation
  lastRecoveryAtMsByConnectionId: ReadonlyMap<string, number>
  nowMs: number
}): MihomoQuicStallRecoveryPlan {
  const { observation, nowMs } = input
  if (observation.stallMs < MIHOMO_QUIC_STALL_VITALITY_TRIGGER_MS) {
    return { action: 'none', reason: 'below_vitality_threshold' }
  }

  if (observation.kind === 'aggregate') {
    return { action: 'vitality_dial', reason: 'aggregate_frozen_quic' }
  }

  const connectionId = observation.connectionId?.trim()
  if (!connectionId) {
    return { action: 'vitality_dial', reason: 'single_missing_connection_id' }
  }

  const lastRecoveryAtMs = input.lastRecoveryAtMsByConnectionId.get(connectionId)
  if (
    lastRecoveryAtMs != null &&
    nowMs - lastRecoveryAtMs < MIHOMO_QUIC_STALL_RECOVERY_COOLDOWN_MS
  ) {
    return { action: 'none', reason: 'recovery_cooldown' }
  }

  if (observation.stallMs >= MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS) {
    return { action: 'close_connection', reason: 'single_stall_exceeded_close_threshold' }
  }

  return { action: 'vitality_dial', reason: 'single_stall_vitality' }
}

export function formatMihomoQuicStallRecoveryLogLine(fields: {
  outcome: 'executed' | 'skipped' | 'failed'
  action: MihomoQuicStallRecoveryAction
  reason: string
  leaf: string
  stallMs: number
  cursorConnectionCount: number
  connectionId?: string
  host?: string
  vitalityDelayMs?: number
  err?: string
}): string {
  const parts = [
    '[MihomoQuicStallRecovery]:',
    `outcome=${fields.outcome}`,
    `action=${fields.action}`,
    `reason=${fields.reason}`,
    `leaf=${fields.leaf}`,
    `stall_ms=${fields.stallMs}`,
    `cursor_conn=${fields.cursorConnectionCount}`,
  ]
  if (fields.connectionId) {
    parts.push(`connection_id=${fields.connectionId}`)
  }
  if (fields.host) {
    parts.push(`host=${fields.host}`)
  }
  if (fields.vitalityDelayMs != null) {
    parts.push(`connect_path_delay_ms=${fields.vitalityDelayMs}`)
  }
  if (fields.err) {
    parts.push(`err=${fields.err}`)
  }
  return `${parts.join(' ')}\n`
}
