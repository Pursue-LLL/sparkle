// [INPUT] MihomoQuicSilentStallObservation · token gap snapshot · cooldown state
// [OUTPUT] resolveFrozenSurgicalPrunePlan
// [POS] R-34c SSOT — five-gate AND for closing a single byte-frozen connection (replaces marathon_block_close).

import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import { resolveCriticalHostCloseDenialPlan } from './stallEscalationLadderCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'
import {
  resolveMarathonSseCarrierPruneContext,
  MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS
} from './marathonSseCarrierPruneCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'
import { resolveMarathonParentRecoveryStallProof } from './marathonParentRecoveryStallProofCore'
import { isMarathonGlobalByteDeath } from './carrierQuiesceRefreshCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

export const MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS = 120_000

export const FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS = 60_000
export const FROZEN_SURGICAL_PRUNE_CONNECTION_COOLDOWN_MS = 120_000
export const FROZEN_SURGICAL_PRUNE_BYTE_FROZEN_PROOF_MS = 30_000

export type FrozenSurgicalPruneAction = 'none' | 'vitality_dial' | 'close_frozen_connection'

export interface FrozenSurgicalPrunePlan {
  action: FrozenSurgicalPruneAction
  reason: string
  carrierRid?: string
  staleProofKind?: string
}

export interface FrozenSurgicalPruneGateInput {
  observation: MihomoQuicSilentStallObservation
  tokenGapMaxMs: number
  staleRequestIdCount: number
  lastGlobalPruneAtMs: number
  lastRecoveryAtMsByConnectionId: ReadonlyMap<string, number>
  nowMs: number
  marathonActive?: boolean
  registryMaxGapSinceActivityMs?: number
  registry?: MarathonStreamRegistry
  staleRequestIds?: readonly string[]
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
  maxByteStallMs?: number
}

function resolveMarathonGlobalByteDeathForPrune(
  input: FrozenSurgicalPruneGateInput,
  marathonActive: boolean,
): boolean {
  const snapshot: TransportLongevityTruthSnapshot = {
    schemaVersion: 2,
    updatedAtMs: input.nowMs,
    cursorConnectionCount: input.observation.cursorConnectionCount,
    httpParentChainAgeMs: input.httpParentChainAgeMs ?? 0,
    outboundHy2SessionAgeMs: input.outboundHy2SessionAgeMs ?? 0,
    maxByteStallMs: input.maxByteStallMs ?? input.observation.stallMs,
    frozenQuicCursorCount: input.observation.frozenQuicCursorCount,
    activeHy2Leaf: input.observation.leaf,
  }
  return isMarathonGlobalByteDeath({
    marathonActive,
    snapshot,
    recoveryIneffective: true,
  })
}

function hasCurrentRequestBoundStallProof(
  input: FrozenSurgicalPruneGateInput,
  marathonActive: boolean
): boolean {
  const marathonGlobalByteDeath = resolveMarathonGlobalByteDeathForPrune(input, marathonActive)
  const stallMs = input.maxByteStallMs ?? input.observation.stallMs
  if (marathonGlobalByteDeath && stallMs >= 90_000 && input.staleRequestIdCount > 0) {
    return true
  }
  const parentRecovery = resolveMarathonParentRecoveryStallProof({
    marathonActive,
    observation: input.observation,
    httpParentChainAgeMs: input.httpParentChainAgeMs,
    outboundHy2SessionAgeMs: input.outboundHy2SessionAgeMs,
  })
  if (parentRecovery.proof) {
    return true
  }
  return (
    marathonActive &&
    input.tokenGapMaxMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS &&
    input.staleRequestIdCount > 0 &&
    (input.staleRequestIds?.length ?? 0) > 0
  )
}

function denyCriticalHostClose(
  host: string | undefined,
  fallbackReason: string
): FrozenSurgicalPrunePlan | undefined {
  const denial = resolveCriticalHostCloseDenialPlan(host)
  if (!denial) {
    return undefined
  }
  return { action: 'vitality_dial', reason: fallbackReason }
}

export function resolveFrozenSurgicalPrunePlan(
  input: FrozenSurgicalPruneGateInput
): FrozenSurgicalPrunePlan {
  const { observation, nowMs } = input
  const marathonActive = input.marathonActive === true

  if (observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return { action: 'none', reason: 'below_vitality_threshold' }
  }

  // A quiet HTTP/2 connection is valid while the model thinks or a tool runs.
  // Never create recovery traffic from byte silence alone: require a currently
  // active marathon request with both token-gap and request-id evidence.
  if (!hasCurrentRequestBoundStallProof(input, marathonActive)) {
    return { action: 'none', reason: 'missing_current_request_bound_stall_proof' }
  }

  if (observation.kind === 'aggregate') {
    return { action: 'vitality_dial', reason: 'aggregate_frozen_quic' }
  }

  const connectionId = observation.connectionId?.trim()
  if (!connectionId) {
    return { action: 'vitality_dial', reason: 'single_missing_connection_id' }
  }

  const lastConnectionRecoveryAtMs = input.lastRecoveryAtMsByConnectionId.get(connectionId)
  const marathonGlobalByteDeath = resolveMarathonGlobalByteDeathForPrune(input, marathonActive)
  if (
    !marathonGlobalByteDeath &&
    lastConnectionRecoveryAtMs != null &&
    nowMs - lastConnectionRecoveryAtMs < FROZEN_SURGICAL_PRUNE_CONNECTION_COOLDOWN_MS
  ) {
    return { action: 'none', reason: 'connection_recovery_cooldown' }
  }

  const carrierContext = resolveMarathonSseCarrierPruneContext({
    observation,
    marathonActive,
    tokenGapMaxMs: input.tokenGapMaxMs,
    staleRequestIds: input.staleRequestIds ?? [],
    staleRequestIdCount: input.staleRequestIdCount,
    registry: input.registry ?? { records: new Map() },
    nowMs
  })
  if (carrierContext.eligible && observation.stallMs >= MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    const tokenGapProof =
      input.tokenGapMaxMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS &&
      ((input.staleRequestIds?.length ?? 0) > 0 ||
        (input.marathonActive &&
          input.staleRequestIdCount > 0 &&
          (input.staleRequestIds?.length ?? 0) === 0 &&
          observation.stallMs >= MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS))
    if (
      nowMs - input.lastGlobalPruneAtMs < FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS &&
      !tokenGapProof
    ) {
      return {
        action: 'vitality_dial',
        reason: 'global_prune_cooldown',
        carrierRid: carrierContext.carrierRid,
        staleProofKind: carrierContext.staleProofKind
      }
    }
    const carrierCloseDenied = denyCriticalHostClose(
      observation.host,
      'r41_critical_host_carrier_no_close'
    )
    if (carrierCloseDenied) {
      return {
        ...carrierCloseDenied,
        carrierRid: carrierContext.carrierRid,
        staleProofKind: carrierContext.staleProofKind
      }
    }
    return {
      action: 'close_frozen_connection',
      reason: 'marathon_sse_carrier_frozen_prune',
      carrierRid: carrierContext.carrierRid,
      staleProofKind: carrierContext.staleProofKind
    }
  }

  // P10-2 Tier-0: parent recovery stall proof → vitality + SEL escalation (R-41 preserves critical host).
  // Sep 2 06:20 class: 45–89s frozen_quic + token_gap=0 must not dead-end at zero_data_plane_mutation.
  if (marathonActive) {
    const parentRecovery = resolveMarathonParentRecoveryStallProof({
      marathonActive,
      observation,
      httpParentChainAgeMs: input.httpParentChainAgeMs,
      outboundHy2SessionAgeMs: input.outboundHy2SessionAgeMs,
    })
    if (
      parentRecovery.proof &&
      observation.stallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS &&
      parentRecovery.kind != null
    ) {
      return {
        action: 'vitality_dial',
        reason: `marathon_tier0_${parentRecovery.kind}_sel`,
        staleProofKind: parentRecovery.kind,
      }
    }
    return { action: 'none', reason: 'marathon_active_zero_data_plane_mutation' }
  }

  if (observation.stallMs >= MIHOMO_QUIC_STALL_CLOSE_CONNECTION_MS) {
    const host = observation.host?.trim() ?? ''
    if (!host || !isCriticalCursorHost(host)) {
      return { action: 'vitality_dial', reason: 'non_critical_host_no_prune' }
    }
    if (
      observation.stallMs <
      FROZEN_SURGICAL_PRUNE_BYTE_FROZEN_PROOF_MS + MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS
    ) {
      return { action: 'vitality_dial', reason: 'byte_frozen_proof_insufficient' }
    }
    if (input.tokenGapMaxMs < CURSOR_HY2_TOKEN_GAP_FORCE_MS || input.staleRequestIdCount <= 0) {
      return { action: 'vitality_dial', reason: 'no_token_gap_stale_proof' }
    }
    if (nowMs - input.lastGlobalPruneAtMs < FROZEN_SURGICAL_PRUNE_GLOBAL_COOLDOWN_MS) {
      return { action: 'vitality_dial', reason: 'global_prune_cooldown' }
    }
    const legacyCloseDenied = denyCriticalHostClose(observation.host, 'r41_critical_host_no_close')
    if (legacyCloseDenied) {
      return legacyCloseDenied
    }
    return { action: 'close_frozen_connection', reason: 'frozen_surgical_prune' }
  }

  return { action: 'vitality_dial', reason: 'single_stall_vitality' }
}
