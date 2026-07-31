// [INPUT] TransportLongevityTruthSnapshot · marathon truth · cooldown state
// [OUTPUT] resolveHy2ParentSidecarPlan · formatHy2ParentSidecarLogLine
// [POS] R-35a SSOT — proactive HY2 parent session sidecar dial @ 4h (non-destructive).

import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

/** Proactive sidecar dial when outbound HY2 UDP session exceeds this age during marathon. */
export const HY2_PARENT_SIDECAR_DIAL_AGE_MS = 4 * 60 * 60 * 1000

/** Proactive UDP outbound close only when no healthy inner flows remain. */
export const HY2_PARENT_PROACTIVE_ROTATE_AGE_MS = HY2_PARENT_SIDECAR_DIAL_AGE_MS

export const HY2_PARENT_SIDECAR_COOLDOWN_MS = 300_000

export type Hy2ParentSidecarAction = 'none' | 'sidecar_dial' | 'close_udp_outbound'

export interface Hy2ParentSidecarPlan {
  action: Hy2ParentSidecarAction
  reason: string
  udpConnectionId?: string
  healthyInnerCount?: number
}

export function resolveHy2ParentSidecarDialPlan(input: {
  snapshot: TransportLongevityTruthSnapshot
  marathonTruthActive: boolean
  lastSidecarDialAtMs: number
  nowMs: number
}): Hy2ParentSidecarPlan {
  if (!input.marathonTruthActive) {
    return { action: 'none', reason: 'marathon_inactive' }
  }
  if (input.snapshot.outboundHy2SessionAgeMs < HY2_PARENT_SIDECAR_DIAL_AGE_MS) {
    return { action: 'none', reason: 'session_age_below_sidecar_threshold' }
  }
  if (input.nowMs - input.lastSidecarDialAtMs < HY2_PARENT_SIDECAR_COOLDOWN_MS) {
    return { action: 'none', reason: 'sidecar_cooldown' }
  }
  return {
    action: 'sidecar_dial',
    reason: 'proactive_parent_sidecar_dial',
  }
}

export function formatHy2ParentSidecarLogLine(fields: {
  outcome: 'executed' | 'skipped' | 'failed'
  action: Hy2ParentSidecarAction
  reason: string
  outboundHy2SessionAgeMs: number
  httpParentChainAgeMs?: number
  healthyInnerCount?: number
  udpConnectionId?: string
  connectPathDelayMs?: number
  err?: string
}): string {
  const parts = [
    '[Hy2ParentSidecar]:',
    `outcome=${fields.outcome}`,
    `action=${fields.action}`,
    `reason=${fields.reason}`,
    `outbound_hy2_session_age_ms=${fields.outboundHy2SessionAgeMs}`,
  ]
  if (fields.httpParentChainAgeMs != null) {
    parts.push(`http_parent_chain_age_ms=${fields.httpParentChainAgeMs}`)
  }
  if (fields.healthyInnerCount != null) {
    parts.push(`healthy_inner=${fields.healthyInnerCount}`)
  }
  if (fields.udpConnectionId) {
    parts.push(`udp_connection_id=${fields.udpConnectionId}`)
  }
  if (fields.connectPathDelayMs != null) {
    parts.push(`connect_path_delay_ms=${fields.connectPathDelayMs}`)
  }
  if (fields.err) {
    parts.push(`err=${fields.err}`)
  }
  return `${parts.join(' ')}\n`
}
