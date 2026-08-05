// [INPUT] marathon context · byte stall observation · parent chain age
// [OUTPUT] resolveMarathonParentRecoveryStallProof — bypass token_gap proof when carrier is dead
// [POS] 1.30.12 SSOT — marathon inner recovery when parent refresh alone cannot restore bytes

import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'

export type MarathonParentRecoveryStallProofKind =
  | 'frozen_quic_cluster'
  | 'absolute_byte_stall'
  | 'parent_stale_byte_frozen'

export interface MarathonParentRecoveryStallProofDecision {
  proof: boolean
  kind?: MarathonParentRecoveryStallProofKind
  reason: string
}

export function resolveMarathonParentRecoveryStallProof(input: {
  marathonActive: boolean
  observation: MihomoQuicSilentStallObservation
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
}): MarathonParentRecoveryStallProofDecision {
  if (!input.marathonActive) {
    return { proof: false, reason: 'marathon_inactive' }
  }
  if (input.observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return { proof: false, reason: 'below_byte_frozen_threshold' }
  }
  if (
    input.observation.frozenQuicCursorCount > 0 &&
    input.observation.stallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS
  ) {
    return {
      proof: true,
      kind: 'frozen_quic_cluster',
      reason: 'marathon_parent_recovery_frozen_quic_cluster',
    }
  }
  if (input.observation.stallMs >= MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS) {
    return {
      proof: true,
      kind: 'absolute_byte_stall',
      reason: 'marathon_parent_recovery_absolute_byte_stall',
    }
  }
  const parentAgeMs = Math.max(
    input.httpParentChainAgeMs ?? 0,
    input.outboundHy2SessionAgeMs ?? 0,
  )
  if (
    parentAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS &&
    input.observation.stallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS
  ) {
    return {
      proof: true,
      kind: 'parent_stale_byte_frozen',
      reason: 'marathon_parent_recovery_stale_parent_byte_frozen',
    }
  }
  return { proof: false, reason: 'marathon_parent_recovery_not_proven' }
}
