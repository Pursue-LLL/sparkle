// [INPUT] TransportLongevityTruth · quarantine · token gap · marathon truth
// [OUTPUT] evaluateTransportMutationAllowed · resolveHy2ParentChainAgeMs
// [POS] MTIC-v2 SSOT — single gate for all transport mutations (protocol_upgrade · close · switch).

/** Asar gate marker — upgradeSparkleAsarGateCore.ts */
export const MTIC_V2_TRANSPORT_MUTATION_GATE_MARKER = 'mtic_v2_transport_mutation_gate'

export type TransportMutationKind =
  | 'protocol_upgrade'
  | 'close_connection'
  | 'node_switch'
  | 'health_check_toggle'

export interface TransportMutationSnapshot {
  cursorConnectionCount: number
  marathonTruthActive: boolean
  hy2ParentChainAgeMs: number
  staleRidCount: number
  postCoreRestartQuarantineRemainingMs: number
  hostIsCritical?: boolean
  serverEofProof?: boolean
  /** One-way TLS→HY2 recover — bypass quarantine/hy2 chain (risk-reducing only). */
  marathonHy2RecoverTlsToHy2?: boolean
}

export type TransportMutationAllowReason =
  | 'allowed'
  | 'allowed_marathon_hy2_recover'
  | 'deny_quarantine_active'
  | 'deny_hy2_parent_chain_alive'
  | 'deny_stale_rids_present'
  | 'deny_cursor_conn_active'
  | 'deny_marathon_truth_active'
  | 'deny_critical_host_close'
  | 'deny_unknown_mutation'

export interface TransportMutationDecision {
  allowed: boolean
  reason: TransportMutationAllowReason
}

export function resolveHy2ParentChainAgeMs(input: {
  nowMs: number
  hy2ParentChainBirthMs: number | undefined
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
}): number {
  const birthMs = input.hy2ParentChainBirthMs ?? 0
  if (birthMs > 0 && birthMs <= input.nowMs) {
    return Math.max(0, input.nowMs - birthMs)
  }
  return Math.max(0, input.httpParentChainAgeMs, input.outboundHy2SessionAgeMs)
}

export function evaluateTransportMutationAllowed(
  mutation: TransportMutationKind,
  snapshot: TransportMutationSnapshot,
): TransportMutationDecision {
  if (mutation === 'protocol_upgrade' || mutation === 'node_switch') {
    if (
      mutation === 'node_switch' &&
      snapshot.marathonHy2RecoverTlsToHy2 === true
    ) {
      if (snapshot.cursorConnectionCount > 0) {
        return { allowed: false, reason: 'deny_cursor_conn_active' }
      }
      if (snapshot.marathonTruthActive) {
        return { allowed: false, reason: 'deny_marathon_truth_active' }
      }
      return { allowed: true, reason: 'allowed_marathon_hy2_recover' }
    }
    if (snapshot.postCoreRestartQuarantineRemainingMs > 0) {
      return { allowed: false, reason: 'deny_quarantine_active' }
    }
    if (snapshot.hy2ParentChainAgeMs > 0) {
      return { allowed: false, reason: 'deny_hy2_parent_chain_alive' }
    }
    if (snapshot.staleRidCount > 0) {
      return { allowed: false, reason: 'deny_stale_rids_present' }
    }
    if (snapshot.cursorConnectionCount > 0) {
      return { allowed: false, reason: 'deny_cursor_conn_active' }
    }
    if (snapshot.marathonTruthActive) {
      return { allowed: false, reason: 'deny_marathon_truth_active' }
    }
    return { allowed: true, reason: 'allowed' }
  }

  if (mutation === 'close_connection') {
    if (snapshot.hostIsCritical === true && snapshot.serverEofProof !== true) {
      return { allowed: false, reason: 'deny_critical_host_close' }
    }
    return { allowed: true, reason: 'allowed' }
  }

  if (mutation === 'health_check_toggle') {
    if (snapshot.postCoreRestartQuarantineRemainingMs > 0) {
      return { allowed: false, reason: 'deny_quarantine_active' }
    }
    return { allowed: true, reason: 'allowed' }
  }

  return { allowed: false, reason: 'deny_unknown_mutation' }
}

export function formatTransportMutationGateLogLine(input: {
  mutation: TransportMutationKind
  decision: TransportMutationDecision
  cursorConnectionCount: number
  hy2ParentChainAgeMs: number
  staleRidCount: number
  quarantineRemainingMs: number
}): string {
  return (
    `[TransportMutationGate]: mutation=${input.mutation}` +
    ` outcome=${input.decision.allowed ? 'allowed' : 'denied'}` +
    ` reason=${input.decision.reason}` +
    ` marker=${MTIC_V2_TRANSPORT_MUTATION_GATE_MARKER}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    ` hy2_parent_chain_age_ms=${input.hy2ParentChainAgeMs}` +
    ` stale_rid_count=${input.staleRidCount}` +
    ` quarantine_remaining_ms=${input.quarantineRemainingMs}\n`
  )
}
