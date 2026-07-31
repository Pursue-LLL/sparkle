// [INPUT] MihomoQuicSilentStallObservation · token gap · registry · marathon truth
// [OUTPUT] resolveMarathonSseCarrierPruneContext
// [POS] R-35b′ SSOT — per-rid carrier mapping + stale proof for surgical prune.

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'

/** Registry silence long enough to treat frozen critical-host conn as dead SSE carrier. */
export const MARATHON_SSE_CARRIER_REGISTRY_GAP_MS = 15_000

/** Byte-frozen this long on a critical host during marathon → dead carrier (not tool pause). */
export const MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS = 90_000

export type MarathonSseCarrierStaleProofKind =
  | 'token_gap'
  | 'registry_gap'
  | 'absolute_byte_stall'

export interface MarathonSseCarrierPruneContext {
  eligible: boolean
  carrierRid?: string
  staleProofKind?: MarathonSseCarrierStaleProofKind
  registryMaxGapSinceActivityMs: number
}

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

function resolveStaleRidsFromRegistry(
  registry: MarathonStreamRegistry,
  nowMs: number,
  minGapMs: number,
): Array<{ originalRequestId: string; gapMs: number }> {
  const stale: Array<{ originalRequestId: string; gapMs: number }> = []
  for (const record of registry.records.values()) {
    const gapMs = Math.max(0, nowMs - record.lastActivityMs)
    if (gapMs >= minGapMs) {
      stale.push({ originalRequestId: record.originalRequestId, gapMs })
    }
  }
  return stale.sort((a, b) => b.gapMs - a.gapMs)
}

export function resolveMarathonSseCarrierPruneContext(input: {
  observation: MihomoQuicSilentStallObservation
  marathonActive: boolean
  tokenGapMaxMs: number
  staleRequestIds: readonly string[]
  registry: MarathonStreamRegistry
  nowMs: number
}): MarathonSseCarrierPruneContext {
  const registryMaxGapSinceActivityMs = computeRegistryMaxGapSinceActivityMs(
    input.registry,
    input.nowMs,
  )
  const base = { registryMaxGapSinceActivityMs }

  if (!input.marathonActive || input.observation.kind !== 'single') {
    return { eligible: false, ...base }
  }
  const host = input.observation.host?.trim() ?? ''
  if (!host || !isCriticalCursorHost(host)) {
    return { eligible: false, ...base }
  }
  if (input.observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return { eligible: false, ...base }
  }

  const tokenGapProof =
    input.tokenGapMaxMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS && input.staleRequestIds.length > 0
  if (tokenGapProof) {
    return {
      eligible: true,
      carrierRid: input.staleRequestIds[0]?.trim() || undefined,
      staleProofKind: 'token_gap',
      ...base,
    }
  }

  const registryStale = resolveStaleRidsFromRegistry(
    input.registry,
    input.nowMs,
    MARATHON_SSE_CARRIER_REGISTRY_GAP_MS,
  )
  if (registryStale.length > 0) {
    return {
      eligible: true,
      carrierRid: registryStale[0]?.originalRequestId,
      staleProofKind: 'registry_gap',
      ...base,
    }
  }

  if (input.observation.stallMs >= MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS) {
    let carrierRid: string | undefined
    let maxGap = 0
    for (const record of input.registry.records.values()) {
      const gapMs = Math.max(0, input.nowMs - record.lastActivityMs)
      if (gapMs >= maxGap) {
        maxGap = gapMs
        carrierRid = record.originalRequestId
      }
    }
    return {
      eligible: true,
      carrierRid,
      staleProofKind: 'absolute_byte_stall',
      ...base,
    }
  }

  return { eligible: false, ...base }
}

/** @deprecated use resolveMarathonSseCarrierPruneContext */
export function isMarathonSseCarrierStaleCandidate(input: {
  observation: MihomoQuicSilentStallObservation
  marathonActive: boolean
  tokenGapMaxMs: number
  staleRequestIdCount: number
  registryMaxGapSinceActivityMs: number
}): boolean {
  return (
    resolveMarathonSseCarrierPruneContext({
      observation: input.observation,
      marathonActive: input.marathonActive,
      tokenGapMaxMs: input.tokenGapMaxMs,
      staleRequestIds:
        input.staleRequestIdCount > 0 && input.tokenGapMaxMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS
          ? ['stale']
          : [],
      registry: { records: new Map() },
      nowMs: Date.now(),
    }).eligible ||
    (input.registryMaxGapSinceActivityMs >= MARATHON_SSE_CARRIER_REGISTRY_GAP_MS &&
      input.marathonActive &&
      input.observation.kind === 'single' &&
      !!input.observation.host &&
      isCriticalCursorHost(input.observation.host) &&
      input.observation.stallMs >= MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS)
  )
}
