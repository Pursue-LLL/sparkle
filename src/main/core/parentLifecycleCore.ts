// [INPUT] persisted hy2 parent chain age · byte stall · recovery state
// [OUTPUT] Parent lifecycle phase for Plane B orchestration
// [POS] Phase B SSOT — single lifecycle machine (replaces scattered 4h/18h gates)

import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import {
  CARRIER_QUIESCE_BYTE_FROZEN_MS,
  isCarrierByteFrozen,
} from './carrierQuiesceRefreshCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

export const PARENT_LIFECYCLE_YOUNG_MS = 3 * 60 * 60 * 1000

export type ParentLifecyclePhase =
  | 'young'
  | 'aging'
  | 'refresh_due'
  | 'stale'
  | 'emergency'
  | 'exhausted'

export function resolveParentLifecyclePhase(input: {
  snapshot: TransportLongevityTruthSnapshot
  recoveryIneffective: boolean
  refreshExhausted: boolean
}): ParentLifecyclePhase {
  const ageMs = Math.max(
    input.snapshot.httpParentChainAgeMs,
    input.snapshot.outboundHy2SessionAgeMs,
  )
  if (input.refreshExhausted) {
    return 'exhausted'
  }
  if (
    input.recoveryIneffective &&
    isCarrierByteFrozen(input.snapshot) &&
    ageMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS
  ) {
    return 'emergency'
  }
  if (
    input.snapshot.maxByteStallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS ||
    input.snapshot.frozenQuicCursorCount > 0
  ) {
    if (ageMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS) {
      return 'stale'
    }
    return 'aging'
  }
  if (ageMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS) {
    return 'refresh_due'
  }
  if (ageMs >= PARENT_LIFECYCLE_YOUNG_MS) {
    return 'aging'
  }
  return 'young'
}

export function formatParentLifecycleLogLine(fields: {
  phase: ParentLifecyclePhase
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  maxByteStallMs: number
}): string {
  return (
    `[ParentLifecycle]: phase=${fields.phase} ` +
    `http_parent_chain_age_ms=${fields.httpParentChainAgeMs} ` +
    `outbound_hy2_session_age_ms=${fields.outboundHy2SessionAgeMs} ` +
    `max_byte_stall_ms=${fields.maxByteStallMs}\n`
  )
}
