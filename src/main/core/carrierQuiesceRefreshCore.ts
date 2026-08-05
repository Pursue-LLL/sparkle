// [INPUT] TransportLongevityTruthSnapshot · byte stall · recovery ineffective signals
// [OUTPUT] CarrierQuiesceRefresh — R-41 narrow bypass for active_inner during parent refresh
// [POS] Phase B SSOT — close UDP parent when carrier bytes frozen despite active inner TCP flows

import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { STALL_ESCALATION_VITALITY_INEFFECTIVE_MS } from './stallEscalationLadderCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

/** Carrier bytes unchanged long enough to treat as dead SSE carrier (not model thinking). */
export const CARRIER_QUIESCE_BYTE_FROZEN_MS = 45_000

/** Parent chain older than this forces UDP refresh even without byte-freeze proof. */
export const PARENT_EMERGENCY_REFRESH_AGE_MS = 2 * HY2_PARENT_SIDECAR_DIAL_AGE_MS

export interface CarrierQuiesceRefreshInput {
  snapshot: TransportLongevityTruthSnapshot
  activeInnerCriticalCount: number
  recoveryIneffective: boolean
}

export interface CarrierQuiesceRefreshDecision {
  bypassActiveInner: boolean
  reason: string
}

export function isParentRefreshDue(snapshot: TransportLongevityTruthSnapshot): boolean {
  return (
    snapshot.httpParentChainAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS ||
    snapshot.outboundHy2SessionAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS
  )
}

export function isCarrierByteFrozen(snapshot: TransportLongevityTruthSnapshot): boolean {
  return (
    snapshot.maxByteStallMs >= CARRIER_QUIESCE_BYTE_FROZEN_MS ||
    snapshot.frozenQuicCursorCount > 0
  )
}

export function isCarrierRecoveryIneffective(snapshot: TransportLongevityTruthSnapshot): boolean {
  return snapshot.maxByteStallMs >= STALL_ESCALATION_VITALITY_INEFFECTIVE_MS
}

export function isParentEmergencyRefreshDue(snapshot: TransportLongevityTruthSnapshot): boolean {
  return (
    snapshot.httpParentChainAgeMs >= PARENT_EMERGENCY_REFRESH_AGE_MS ||
    snapshot.outboundHy2SessionAgeMs >= PARENT_EMERGENCY_REFRESH_AGE_MS
  )
}

export function resolveCarrierQuiesceRefreshDecision(
  input: CarrierQuiesceRefreshInput,
): CarrierQuiesceRefreshDecision {
  if (input.activeInnerCriticalCount <= 0) {
    return { bypassActiveInner: false, reason: 'no_active_inner' }
  }
  if (isParentEmergencyRefreshDue(input.snapshot)) {
    return {
      bypassActiveInner: true,
      reason: 'parent_emergency_refresh_bypass_active_inner',
    }
  }
  if (!isParentRefreshDue(input.snapshot)) {
    return { bypassActiveInner: false, reason: 'parent_not_refresh_due' }
  }
  if (!isCarrierByteFrozen(input.snapshot)) {
    return { bypassActiveInner: false, reason: 'carrier_not_byte_frozen' }
  }
  const ineffective = input.recoveryIneffective || isCarrierRecoveryIneffective(input.snapshot)
  if (!ineffective) {
    return { bypassActiveInner: false, reason: 'recovery_not_yet_ineffective' }
  }
  return {
    bypassActiveInner: true,
    reason: 'carrier_quiesce_refresh_bypass_active_inner',
  }
}

export function formatCarrierQuiesceRefreshLogLine(fields: {
  outcome: 'planned' | 'executed' | 'skipped' | 'failed'
  reason: string
  activeInnerCriticalCount: number
  httpParentChainAgeMs: number
  maxByteStallMs: number
  frozenQuicCursorCount: number
  udpConnectionId?: string
  err?: string
}): string {
  const parts = [
    '[CarrierQuiesceRefresh]:',
    `outcome=${fields.outcome}`,
    `reason=${fields.reason}`,
    `active_inner=${fields.activeInnerCriticalCount}`,
    `http_parent_chain_age_ms=${fields.httpParentChainAgeMs}`,
    `max_byte_stall_ms=${fields.maxByteStallMs}`,
    `frozen_quic_cursor=${fields.frozenQuicCursorCount}`,
  ]
  if (fields.udpConnectionId) {
    parts.push(`udp_connection_id=${fields.udpConnectionId}`)
  }
  if (fields.err) {
    parts.push(`err=${fields.err}`)
  }
  return `${parts.join(' ')}\n`
}
