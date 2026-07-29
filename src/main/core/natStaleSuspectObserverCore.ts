// [INPUT] hy2TunnelVitalityCore::inferNatStaleSuspect
// [OUTPUT] buildNatStaleSuspectObservation · formatNatStaleSuspectLogLine · natStaleSuspectDedupeKey
// [POS] P27b SSOT — split-brain NAT mapping stale triage (observe-only, no recovery).

import { inferNatStaleSuspect } from './hy2TunnelVitalityCore'

export { inferNatStaleSuspect, NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS } from './hy2TunnelVitalityCore'

/** Dedupe repeated server-eof sync passes for the same marathon parent chain. */
export const NAT_STALE_SUSPECT_DEDUPE_COOLDOWN_MS = 300_000

export interface NatStaleSuspectObservationInput {
  tokenGapMs: number
  api2ProbeOk: boolean
  streamPrimarySub: string
  originalRequestId: string
  requestId?: string
  proxyNode?: string
  probeLatencyMs?: number
  cursorConnectionCount?: number
  tsMs: number
}

export interface NatStaleSuspectObservation {
  tokenGapMs: number
  api2ProbeOk: boolean
  streamPrimarySub: string
  originalRequestId: string
  requestId?: string
  proxyNode?: string
  probeLatencyMs?: number
  cursorConnectionCount?: number
  tsMs: number
}

export function buildNatStaleSuspectObservation(
  input: NatStaleSuspectObservationInput,
): NatStaleSuspectObservation | undefined {
  if (
    !inferNatStaleSuspect({
      tokenGapMs: input.tokenGapMs,
      api2ProbeOk: input.api2ProbeOk,
      streamPrimarySub: input.streamPrimarySub,
    })
  ) {
    return undefined
  }
  if (!input.originalRequestId.trim()) {
    return undefined
  }
  return {
    tokenGapMs: input.tokenGapMs,
    api2ProbeOk: input.api2ProbeOk,
    streamPrimarySub: input.streamPrimarySub,
    originalRequestId: input.originalRequestId,
    requestId: input.requestId,
    proxyNode: input.proxyNode,
    probeLatencyMs: input.probeLatencyMs,
    cursorConnectionCount: input.cursorConnectionCount,
    tsMs: input.tsMs,
  }
}

export function natStaleSuspectDedupeKey(originalRequestId: string): string {
  return originalRequestId.trim()
}

export function shouldSkipNatStaleSuspectDedupe(
  lastEmitAtMs: number | undefined,
  nowMs: number,
  cooldownMs: number = NAT_STALE_SUSPECT_DEDUPE_COOLDOWN_MS,
): boolean {
  if (lastEmitAtMs == null || lastEmitAtMs <= 0) {
    return false
  }
  return nowMs - lastEmitAtMs < cooldownMs
}

export function formatNatStaleSuspectLogLine(obs: NatStaleSuspectObservation): string {
  const parts = [
    '[NatStaleSuspect]:',
    'outcome=observed',
    'observe_only=true',
    `token_gap_ms=${obs.tokenGapMs}`,
    `api2_probe_ok=${obs.api2ProbeOk}`,
    `stream_primary_sub=${obs.streamPrimarySub}`,
    `original_request_id=${obs.originalRequestId}`,
  ]
  if (obs.requestId) {
    parts.push(`request_id=${obs.requestId}`)
  }
  if (obs.proxyNode) {
    parts.push(`proxy_node=${obs.proxyNode}`)
  }
  if (obs.probeLatencyMs != null && obs.probeLatencyMs > 0) {
    parts.push(`probe_latency_ms=${obs.probeLatencyMs}`)
  }
  if (obs.cursorConnectionCount != null) {
    parts.push(`cursor_conn=${obs.cursorConnectionCount}`)
  }
  return `${parts.join(' ')}\n`
}
