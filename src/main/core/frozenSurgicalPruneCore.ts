// [INPUT] MihomoQuicSilentStallObservation · token gap snapshot · cooldown state
// [OUTPUT] resolveFrozenSurgicalPrunePlan
// [POS] R-34c SSOT — five-gate AND for closing a single byte-frozen connection (replaces marathon_block_close).

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'

export const MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS = 120_000

export const FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS = 60_000
export const FROZEN_SURGICAL_PRUNE_CONNECTION_COOLDOWN_MS = 120_000
export const FROZEN_SURGICAL_PRUNE_BYTE_FROZEN_PROOF_MS = 30_000

export type FrozenSurgicalPruneAction = 'none' | 'vitality_dial' | 'close_frozen_connection'

export interface FrozenSurgicalPrunePlan {
  action: FrozenSurgicalPruneAction
  reason: string
}

export interface FrozenSurgicalPruneGateInput {
  observation: MihomoQuicSilentStallObservation
  tokenGapMaxMs: number
  staleRequestIdCount: number
  lastGlobalPruneAtMs: number
  lastRecoveryAtMsByConnectionId: ReadonlyMap<string, number>
  nowMs: number
}

export function resolveFrozenSurgicalPrunePlan(input: FrozenSurgicalPruneGateInput): FrozenSurgicalPrunePlan {
  const { observation, nowMs } = input

  if (observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return { action: 'none', reason: 'below_vitality_threshold' }
  }

  if (observation.kind === 'aggregate') {
    return { action: 'vitality_dial', reason: 'aggregate_frozen_quic' }
  }

  const connectionId = observation.connectionId?.trim()
  if (!connectionId) {
    return { action: 'vitality_dial', reason: 'single_missing_connection_id' }
  }

  const lastConnectionRecoveryAtMs = input.lastRecoveryAtMsByConnectionId.get(connectionId)
  if (
    lastConnectionRecoveryAtMs != null &&
    nowMs - lastConnectionRecoveryAtMs < FROZEN_SURGICAL_PRUNE_CONNECTION_COOLDOWN_MS
  ) {
    return { action: 'none', reason: 'connection_recovery_cooldown' }
  }

  if (observation.stallMs >= MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS) {
    const host = observation.host?.trim() ?? ''
    if (!host || !isCriticalCursorHost(host)) {
      return { action: 'vitality_dial', reason: 'non_critical_host_no_prune' }
    }
    if (observation.stallMs < FROZEN_SURGICAL_PRUNE_BYTE_FROZEN_PROOF_MS + MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
      return { action: 'vitality_dial', reason: 'byte_frozen_proof_insufficient' }
    }
    if (input.tokenGapMaxMs < CURSOR_HY2_TOKEN_GAP_FORCE_MS || input.staleRequestIdCount <= 0) {
      return { action: 'vitality_dial', reason: 'no_token_gap_stale_proof' }
    }
    if (nowMs - input.lastGlobalPruneAtMs < FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS) {
      return { action: 'vitality_dial', reason: 'global_prune_cooldown' }
    }
    return { action: 'close_frozen_connection', reason: 'frozen_surgical_prune' }
  }

  return { action: 'vitality_dial', reason: 'single_stall_vitality' }
}
