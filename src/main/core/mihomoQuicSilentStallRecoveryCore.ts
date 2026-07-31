// [INPUT] frozenSurgicalPruneCore · mihomoQuicSilentStallCore observations
// [OUTPUT] stall recovery log formatter · legacy plan alias for tests
// [POS] R-33/R-34 constants + log format SSOT.

import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'
import {
  resolveFrozenSurgicalPrunePlan,
  type FrozenSurgicalPruneAction,
} from './frozenSurgicalPruneCore'

/** Trigger lightweight connect_path vitality once byte-frozen threshold is met. */
export const MIHOMO_QUIC_STALL_VITALITY_TRIGGER_MS = MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS

/** Close one frozen critical-host flow after this stall duration. */
export const MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS = 120_000

/** Per-connection recovery cooldown — avoid close/vitality storms on the same id. */
export const MIHOMO_QUIC_STALL_RECOVERY_COOLDOWN_MS = 60_000

export type MihomoQuicStallRecoveryAction = 'none' | 'vitality_dial' | 'close_connection'

export interface MihomoQuicStallRecoveryPlan {
  action: MihomoQuicStallRecoveryAction
  reason: string
}

function mapFrozenAction(action: FrozenSurgicalPruneAction): MihomoQuicStallRecoveryAction {
  if (action === 'close_frozen_connection') {
    return 'close_connection'
  }
  if (action === 'vitality_dial') {
    return 'vitality_dial'
  }
  return 'none'
}

/** @deprecated R-34 — use resolveFrozenSurgicalPrunePlan. Kept for unit test migration. */
export function resolveMihomoQuicStallRecoveryPlan(input: {
  observation: MihomoQuicSilentStallObservation
  lastRecoveryAtMsByConnectionId: ReadonlyMap<string, number>
  nowMs: number
  tokenGapMaxMs?: number
  staleRequestIdCount?: number
  lastGlobalPruneAtMs?: number
}): MihomoQuicStallRecoveryPlan {
  const plan = resolveFrozenSurgicalPrunePlan({
    observation: input.observation,
    tokenGapMaxMs: input.tokenGapMaxMs ?? 0,
    staleRequestIdCount: input.staleRequestIdCount ?? 0,
    lastGlobalPruneAtMs: input.lastGlobalPruneAtMs ?? 0,
    lastRecoveryAtMsByConnectionId: input.lastRecoveryAtMsByConnectionId,
    nowMs: input.nowMs,
  })
  return { action: mapFrozenAction(plan.action), reason: plan.reason }
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
  pruneDenialReason?: string
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
  registryMaxGapSinceActivityMs?: number
  tokenGapMaxMs?: number
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
  if (fields.pruneDenialReason) {
    parts.push(`prune_denial_reason=${fields.pruneDenialReason}`)
  }
  if (fields.httpParentChainAgeMs != null) {
    parts.push(`http_parent_chain_age_ms=${fields.httpParentChainAgeMs}`)
  }
  if (fields.outboundHy2SessionAgeMs != null) {
    parts.push(`outbound_hy2_session_age_ms=${fields.outboundHy2SessionAgeMs}`)
  }
  if (fields.registryMaxGapSinceActivityMs != null) {
    parts.push(`registry_max_gap_ms=${fields.registryMaxGapSinceActivityMs}`)
  }
  if (fields.tokenGapMaxMs != null) {
    parts.push(`token_gap_max_ms=${fields.tokenGapMaxMs}`)
  }
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
