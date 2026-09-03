// [INPUT] mutation kind · marathon context · stall/parent proof
// [OUTPUT] classifyDataPlaneMutationTier · evaluateMarathonDataPlaneMutation
// [POS] BUG-2026-09-03-001 SSOT — Tier-0/1/2 data-plane mutation gate (replaces caller-layer opt-in).

import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import type { MarathonParentRecoveryStallProofKind } from './marathonParentRecoveryStallProofCore'

export const DATA_PLANE_MUTATION_TIER_MARKER = 'data_plane_mutation_tier_v1'

export type DataPlaneMutationTier = 0 | 1 | 2

export type DataPlaneMutationKind =
  | 'close_single_connection'
  | 'provider_hot_reload'
  | 'sidecar_udp_refresh'
  | 'failover_leaf'
  | 'core_cold_restart'

export type MarathonDataPlaneMutationReason =
  | 'allowed_tier0'
  | 'allowed_tier1'
  | 'allowed_tier2'
  | 'defer_marathon_tier2_blocked'
  | 'defer_no_stall_proof'
  | 'deny_unknown_mutation'

export interface MarathonDataPlaneMutationDecision {
  allowed: boolean
  tier: DataPlaneMutationTier
  reason: MarathonDataPlaneMutationReason
}

export function classifyDataPlaneMutationTier(kind: DataPlaneMutationKind): DataPlaneMutationTier {
  switch (kind) {
    case 'close_single_connection':
    case 'provider_hot_reload':
      return 0
    case 'sidecar_udp_refresh':
    case 'failover_leaf':
      return 1
    case 'core_cold_restart':
      return 2
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function evaluateMarathonDataPlaneMutation(input: {
  kind: DataPlaneMutationKind
  marathonActive: boolean
  cursorConnectionCount: number
  parentRecoveryProof?: boolean
  parentRecoveryKind?: MarathonParentRecoveryStallProofKind
  stallMs?: number
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
}): MarathonDataPlaneMutationDecision {
  const tier = classifyDataPlaneMutationTier(input.kind)

  if (!input.marathonActive) {
    return { allowed: true, tier, reason: tier === 2 ? 'allowed_tier2' : tier === 1 ? 'allowed_tier1' : 'allowed_tier0' }
  }

  if (tier === 0) {
    if (input.kind === 'provider_hot_reload') {
      return { allowed: true, tier: 0, reason: 'allowed_tier0' }
    }
    if (input.parentRecoveryProof === true) {
      return { allowed: true, tier: 0, reason: 'allowed_tier0' }
    }
    return { allowed: false, tier: 0, reason: 'defer_no_stall_proof' }
  }

  if (tier === 1) {
    const parentAgeMs = Math.max(input.httpParentChainAgeMs ?? 0, input.outboundHy2SessionAgeMs ?? 0)
    const stallMs = input.stallMs ?? 0
    const parentStaleProof =
      input.parentRecoveryKind === 'parent_stale_byte_frozen' ||
      (parentAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS && stallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS)
    if (input.parentRecoveryProof === true || parentStaleProof) {
      return { allowed: true, tier: 1, reason: 'allowed_tier1' }
    }
    return { allowed: false, tier: 1, reason: 'defer_no_stall_proof' }
  }

  if (input.cursorConnectionCount > 0) {
    return { allowed: false, tier: 2, reason: 'defer_marathon_tier2_blocked' }
  }
  return { allowed: true, tier: 2, reason: 'allowed_tier2' }
}

export function formatDataPlaneMutationTierLogLine(input: {
  kind: DataPlaneMutationKind
  decision: MarathonDataPlaneMutationDecision
  cursorConnectionCount: number
  stallMs?: number
  parentRecoveryKind?: string
}): string {
  return (
    `[DataPlaneMutationTier]: kind=${input.kind}` +
    ` tier=${input.decision.tier}` +
    ` outcome=${input.decision.allowed ? 'allowed' : 'deferred'}` +
    ` reason=${input.decision.reason}` +
    ` marker=${DATA_PLANE_MUTATION_TIER_MARKER}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    (input.stallMs != null ? ` stall_ms=${input.stallMs}` : '') +
    (input.parentRecoveryKind ? ` parent_proof=${input.parentRecoveryKind}` : '') +
    `\n`
  )
}
