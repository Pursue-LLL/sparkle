// [INPUT] MihomoQuicSilentStallObservation · token gap · registry gap
// [OUTPUT] isMarathonSseCarrierStaleCandidate · computeRegistryMaxGapSinceActivityMs
// [POS] R-35b SSOT — marathon SSE carrier surgical prune stale-proof gate.

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'

/** Registry silence long enough to treat frozen critical-host conn as dead SSE carrier. */
export const MARATHON_SSE_CARRIER_REGISTRY_GAP_MS = 15_000

export function computeRegistryMaxGapSinceActivityMs(
  registry: MarathonStreamRegistry,
  nowMs: number,
): number {
  let maxGapMs = 0
  for (const record of registry.records.values()) {
    maxGapMs = Math.max(maxGapMs, Math.max(0, nowMs - record.lastActivityMs))
  }
  return maxGapMs
}

export interface MarathonSseCarrierPruneGateInput {
  observation: MihomoQuicSilentStallObservation
  marathonActive: boolean
  tokenGapMaxMs: number
  staleRequestIdCount: number
  registryMaxGapSinceActivityMs: number
}

export function isMarathonSseCarrierStaleCandidate(input: MarathonSseCarrierPruneGateInput): boolean {
  if (!input.marathonActive || input.observation.kind !== 'single') {
    return false
  }
  const host = input.observation.host?.trim() ?? ''
  if (!host || !isCriticalCursorHost(host)) {
    return false
  }
  if (input.observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return false
  }
  const tokenGapProof =
    input.tokenGapMaxMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS && input.staleRequestIdCount > 0
  const registryGapProof = input.registryMaxGapSinceActivityMs >= MARATHON_SSE_CARRIER_REGISTRY_GAP_MS
  return tokenGapProof || registryGapProof
}
