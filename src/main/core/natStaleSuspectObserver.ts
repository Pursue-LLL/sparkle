// [INPUT] natStaleSuspectObserverCore · agentTransportFailureWriterCore · cursorStreamTokenGapReader
// [OUTPUT] observeNatStaleSuspectFromTransportFailure
// [POS] P27b runtime — emit network-stability-events + app log (no recovery / no dial).

import type { AgentTransportFailureRow } from './agentTransportFailureWriterCore'
import {
  buildNatStaleSuspectObservation,
  formatNatStaleSuspectLogLine,
  natStaleSuspectDedupeKey,
  shouldSkipNatStaleSuspectDedupe,
} from './natStaleSuspectObserverCore'

const lastEmitByOriginalRequestId = new Map<string, number>()

export function resetNatStaleSuspectObserverForTests(): void {
  lastEmitByOriginalRequestId.clear()
}

export function getNatStaleSuspectLastEmitForTests(originalRequestId: string): number | undefined {
  return lastEmitByOriginalRequestId.get(natStaleSuspectDedupeKey(originalRequestId))
}

async function persistNatStaleSuspectObservation(
  obs: NonNullable<ReturnType<typeof buildNatStaleSuspectObservation>>,
): Promise<void> {
  const dedupeKey = natStaleSuspectDedupeKey(obs.originalRequestId)
  if (shouldSkipNatStaleSuspectDedupe(lastEmitByOriginalRequestId.get(dedupeKey), obs.tsMs)) {
    return
  }
  lastEmitByOriginalRequestId.set(dedupeKey, obs.tsMs)

  const { appendNetworkStabilityEvent } = await import('./networkStabilityMonitor')
  await appendNetworkStabilityEvent({
    ts: new Date(obs.tsMs).toISOString(),
    kind: 'nat_stale_suspect',
    proxy_node: obs.proxyNode,
    probe_ok: obs.api2ProbeOk,
    probe_latency_ms: obs.probeLatencyMs,
    error_detail: `token_gap_ms=${obs.tokenGapMs};stream_primary_sub=${obs.streamPrimarySub};original_request_id=${obs.originalRequestId}${obs.requestId ? `;request_id=${obs.requestId}` : ''}`,
  })

  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(formatNatStaleSuspectLogLine(obs))
}

export async function observeNatStaleSuspectFromTransportFailure(
  row: AgentTransportFailureRow,
  options?: { proxyNodeFallback?: string },
): Promise<boolean> {
  const streamPrimarySub = row.streamPrimarySub ?? 'server-eof'
  if (row.kind !== 'http_sse_transport_failure' || streamPrimarySub !== 'server-eof') {
    return false
  }

  const originalRequestId = row.originalRequestId ?? row.requestId ?? ''
  if (!originalRequestId) {
    return false
  }

  const { countCursorConnections } = await import('./cursorConnectionHygiene')
  const cursorConnectionCount = await countCursorConnections()
  const { readMarathonStreamTokenGapSignal } = await import('./cursorStreamTokenGapReader')
  const tokenGap = await readMarathonStreamTokenGapSignal(cursorConnectionCount, row.ts)
  const tokenGapMs = tokenGap?.maxGapMs ?? 0

  const { getRecentCursorProbe } = await import('./networkStabilityMonitor')
  const probe = getRecentCursorProbe()
  const api2ProbeOk = probe?.ok ?? false

  const observation = buildNatStaleSuspectObservation({
    tokenGapMs,
    api2ProbeOk,
    streamPrimarySub,
    originalRequestId,
    requestId: row.requestId,
    proxyNode: row.proxyNode?.trim() || options?.proxyNodeFallback,
    probeLatencyMs: probe?.latencyMs,
    cursorConnectionCount,
    tsMs: row.ts,
  })
  if (!observation) {
    return false
  }

  await persistNatStaleSuspectObservation(observation)
  return true
}
