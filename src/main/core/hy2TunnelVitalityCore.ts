// [INPUT] MarathonSSETruthResult · cursorHy2MarathonKeepaliveCore QUIC SSOT
// [OUTPUT] shouldRunHy2TunnelVitality · inferNatStaleSuspect · formatHy2TunnelVitalityLogLine
// [POS] P27 SSOT: Mac outbound HY2 tunnel vitality gate (orthogonal to P24 pulse / P15 rescue).

import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  isMarathonQuIcInboundCursorNode,
} from './cursorHy2MarathonKeepaliveCore'
import { MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'

/** Align with VPS sing-box keep_alive_period (30s). */
export const HY2_TUNNEL_VITALITY_INTERVAL_MS = 30_000

/** P28: ultra-conn + aged parent chain — accelerate vitality before mass PING partition. */
export const HY2_TUNNEL_VITALITY_PRE_PARTITION_CONN_THRESHOLD = 80
export const HY2_TUNNEL_VITALITY_PRE_PARTITION_CHAIN_AGE_MS = 43_200_000
export const HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS = 10_000

/** P27b: token gap + green api2 + server-eof → NAT mapping stale suspect (observe-only). */
export const NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS = 180_000

export type Hy2TunnelVitalityOutcome =
  | 'executed'
  | 'skipped_not_due'
  | 'skipped_no_quic_node'
  | 'skipped_in_flight'
  | 'skipped_below_marathon_age'
  | 'skipped_inactive'
  | 'skipped_admission'
  | 'failed'

export interface Hy2TunnelVitalityGateInput {
  nowMs: number
  cursorConnectionCount: number
  lastVitalityAtMs: number
  activeNode: string
  marathonTruthActive: boolean
  maxParentChainAgeMs: number
  /** R-33: QUIC byte-frozen stall recovery bypasses 30min parent-chain age gate. */
  stallRecoveryBypass?: boolean
}

export interface Hy2TunnelVitalityResult {
  outcome: Hy2TunnelVitalityOutcome
  connectPathDelayMs?: number
  err?: string
}

export function isHy2TunnelVitalityPrePartitionRisk(input: Hy2TunnelVitalityGateInput): boolean {
  return (
    input.cursorConnectionCount >= HY2_TUNNEL_VITALITY_PRE_PARTITION_CONN_THRESHOLD &&
    input.maxParentChainAgeMs >= HY2_TUNNEL_VITALITY_PRE_PARTITION_CHAIN_AGE_MS
  )
}

export function resolveHy2TunnelVitalityIntervalMs(input: Hy2TunnelVitalityGateInput): number {
  if (isHy2TunnelVitalityPrePartitionRisk(input)) {
    return HY2_TUNNEL_VITALITY_PRE_PARTITION_INTERVAL_MS
  }
  return HY2_TUNNEL_VITALITY_INTERVAL_MS
}

export function shouldRunHy2TunnelVitality(input: Hy2TunnelVitalityGateInput): boolean {
  if (!isMarathonQuIcInboundCursorNode(input.activeNode)) {
    return false
  }
  if (input.cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  if (!input.marathonTruthActive && !input.stallRecoveryBypass) {
    return false
  }
  if (
    !input.stallRecoveryBypass &&
    input.maxParentChainAgeMs < MTDO_MARATHON_STREAM_MIN_AGE_MS
  ) {
    return false
  }
  const intervalMs = resolveHy2TunnelVitalityIntervalMs(input)
  if (input.lastVitalityAtMs <= 0) {
    return true
  }
  return input.nowMs - input.lastVitalityAtMs >= intervalMs
}

export function resolveHy2TunnelVitalitySkipReason(
  input: Hy2TunnelVitalityGateInput,
): Hy2TunnelVitalityOutcome | undefined {
  if (!isMarathonQuIcInboundCursorNode(input.activeNode)) {
    return 'skipped_no_quic_node'
  }
  if (!input.marathonTruthActive && !input.stallRecoveryBypass) {
    return 'skipped_inactive'
  }
  if (
    !input.stallRecoveryBypass &&
    input.maxParentChainAgeMs < MTDO_MARATHON_STREAM_MIN_AGE_MS
  ) {
    return 'skipped_below_marathon_age'
  }
  const intervalMs = resolveHy2TunnelVitalityIntervalMs(input)
  if (input.lastVitalityAtMs > 0 && input.nowMs - input.lastVitalityAtMs < intervalMs) {
    return 'skipped_not_due'
  }
  return undefined
}

export function inferNatStaleSuspect(fields: {
  tokenGapMs: number
  api2ProbeOk: boolean
  streamPrimarySub: string
}): boolean {
  return (
    fields.streamPrimarySub === 'server-eof' &&
    fields.api2ProbeOk &&
    fields.tokenGapMs >= NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS
  )
}

export function formatHy2TunnelVitalityLogLine(fields: {
  outcome: Hy2TunnelVitalityOutcome
  cursorConnectionCount: number
  node: string
  connectPathDelayMs?: number
  maxParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
  prePartitionRisk?: boolean
  err?: string
}): string {
  const parts = [
    '[Hy2TunnelVitality]:',
    `outcome=${fields.outcome}`,
    `cursor_conn=${fields.cursorConnectionCount}`,
    `node=${fields.node}`,
  ]
  if (fields.prePartitionRisk) {
    parts.push('mode=pre_partition')
  }
  if (fields.maxParentChainAgeMs != null) {
    parts.push(`http_parent_chain_age_ms=${fields.maxParentChainAgeMs}`)
  }
  if (fields.outboundHy2SessionAgeMs != null) {
    parts.push(`outbound_hy2_session_age_ms=${fields.outboundHy2SessionAgeMs}`)
  }
  if (fields.connectPathDelayMs != null) {
    parts.push(`connect_path_delay_ms=${fields.connectPathDelayMs}`)
  }
  if (fields.err) {
    parts.push(`err=${fields.err}`)
  }
  return `${parts.join(' ')}\n`
}
