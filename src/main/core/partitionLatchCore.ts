// [INPUT] HUNG_SCAN_INTERVAL_MS from cursorTransportHealthCore
// [OUTPUT] armPartitionLatch · resolvePartitionLatchCandidate · partitionLatchActive
// [POS] P19/P28 — force connect_partition candidate after blind_spot or structured mass-PING miss;
//       P28 registers affected reqIds at latch arm time (zero-delay stale_rid observability).

import { HUNG_SCAN_INTERVAL_MS } from './cursorTransportHealthCore'
import {
  CONNECT_PARTITION_MIN_PING_FAILURES,
  collectConnectPingFailureRequestIds,
  isConnectPingTransportFailure,
  isHttpSseServerEofTransportFailure,
  type AgentTransportFailureRow,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'
import type { MarathonTransportDialCandidate } from './marathonTransportDialOrchestratorCore'

const LATCH_SCAN_MULTIPLIER = 2
const PARTITION_LATCH_MAX_STALE_RIDS = 32

let partitionLatchUntilMs = 0
let partitionLatchArmedAtMs = 0
let partitionLatchStaleRequestIds: string[] = []

export function resetPartitionLatchStateForTests(): void {
  partitionLatchUntilMs = 0
  partitionLatchArmedAtMs = 0
  partitionLatchStaleRequestIds = []
}

export function partitionLatchActive(nowMs: number): boolean {
  return partitionLatchUntilMs > nowMs
}

export function getPartitionLatchArmedAtMs(): number {
  return partitionLatchArmedAtMs
}

export function getPartitionLatchStaleRequestIds(): readonly string[] {
  return partitionLatchStaleRequestIds
}

export function clearPartitionLatch(): void {
  partitionLatchUntilMs = 0
  partitionLatchArmedAtMs = 0
  partitionLatchStaleRequestIds = []
}

function mergePartitionLatchStaleRequestIds(staleRequestIds: readonly string[]): void {
  if (staleRequestIds.length === 0) {
    return
  }
  const merged = new Set(partitionLatchStaleRequestIds)
  for (const rid of staleRequestIds) {
    const normalized = rid.trim()
    if (normalized) {
      merged.add(normalized)
    }
  }
  partitionLatchStaleRequestIds = [...merged].slice(0, PARTITION_LATCH_MAX_STALE_RIDS)
}

export function armPartitionLatch(nowMs: number, staleRequestIds?: readonly string[]): void {
  partitionLatchUntilMs = nowMs + LATCH_SCAN_MULTIPLIER * HUNG_SCAN_INTERVAL_MS
  partitionLatchArmedAtMs = nowMs
  mergePartitionLatchStaleRequestIds(staleRequestIds ?? [])
}

export function shouldArmPartitionLatchFromMassPingSync(
  writtenRows: readonly AgentTransportFailureRow[],
): boolean {
  let pingCount = 0
  for (const row of writtenRows) {
    if (isConnectPingTransportFailure(row)) {
      pingCount += 1
    }
  }
  return pingCount >= CONNECT_PARTITION_MIN_PING_FAILURES
}

/** P29: partition window mixed symptoms — mass PING and/or co-occurring HTTP SSE server-eof. */
export function shouldArmPartitionLatchFromTransportSync(
  writtenRows: readonly AgentTransportFailureRow[],
): boolean {
  if (shouldArmPartitionLatchFromMassPingSync(writtenRows)) {
    return true
  }
  let pingCount = 0
  let serverEofCount = 0
  for (const row of writtenRows) {
    if (isConnectPingTransportFailure(row)) {
      pingCount += 1
      continue
    }
    if (isHttpSseServerEofTransportFailure(row)) {
      serverEofCount += 1
    }
  }
  return pingCount >= 1 && serverEofCount >= 1
}

export function collectPartitionLatchRequestIds(
  writtenRows: readonly AgentTransportFailureRow[],
): string[] {
  const merged = new Set<string>(collectConnectPingFailureRequestIds(writtenRows))
  for (const row of writtenRows) {
    if (!isHttpSseServerEofTransportFailure(row)) {
      continue
    }
    const rid = String(row.originalRequestId || row.requestId || '').trim()
    if (rid) {
      merged.add(rid)
    }
  }
  return [...merged].slice(0, PARTITION_LATCH_MAX_STALE_RIDS)
}

/** P29b: mass PING sync may precede server-eof by tens of seconds — merge eof RIDs while latch active. */
export function shouldMergePartitionLatchFromLateServerEof(
  writtenRows: readonly AgentTransportFailureRow[],
  nowMs: number,
): boolean {
  if (!partitionLatchActive(nowMs)) {
    return false
  }
  for (const row of writtenRows) {
    if (isHttpSseServerEofTransportFailure(row)) {
      return true
    }
  }
  return false
}

export function collectLateServerEofPartitionLatchRequestIds(
  writtenRows: readonly AgentTransportFailureRow[],
): string[] {
  const ids: string[] = []
  for (const row of writtenRows) {
    if (!isHttpSseServerEofTransportFailure(row)) {
      continue
    }
    const rid = String(row.originalRequestId || row.requestId || '').trim()
    if (rid && !ids.includes(rid)) {
      ids.push(rid)
    }
  }
  return ids.slice(0, PARTITION_LATCH_MAX_STALE_RIDS)
}

export function shouldArmPartitionLatchFromBlindSpot(options: {
  partitionSignal: ConnectPartitionSignal | undefined
  structuredPingCount: number
  candidate: MarathonTransportDialCandidate | undefined
}): boolean {
  if (options.partitionSignal != null) {
    return false
  }
  if (options.structuredPingCount < CONNECT_PARTITION_MIN_PING_FAILURES) {
    return false
  }
  if (options.candidate == null) {
    return true
  }
  return (
    options.candidate.trigger === 'periodic_session' ||
    options.candidate.trigger === 'high_latency_warmth'
  )
}

export function resolvePartitionLatchCandidate(
  nowMs: number,
  _cursorConnectionCount: number,
): MarathonTransportDialCandidate | undefined {
  if (!partitionLatchActive(nowMs)) {
    return undefined
  }
  return {
    trigger: 'connect_partition',
    plan: 'connect_rescue_bundle',
    staleRequestIdCount: partitionLatchStaleRequestIds.length,
    staleRequestIds: [...partitionLatchStaleRequestIds],
  }
}

export function formatPartitionMassPingSyncLogLine(fields: {
  pingRows: number
  serverEofRows?: number
  written: number
  cursorConnectionCount: number
  affectedRequestIds: readonly string[]
  latchReason?: 'mass_ping' | 'mixed_ping_eof'
}): string {
  const parts = [
    '[PartitionMassPingSync]:',
    'armed latch',
    `reason=${fields.latchReason ?? 'mass_ping'}`,
    `ping_rows=${fields.pingRows}`,
  ]
  if ((fields.serverEofRows ?? 0) > 0) {
    parts.push(`server_eof_rows=${fields.serverEofRows}`)
  }
  parts.push(`written=${fields.written}`, `cursor_conn=${fields.cursorConnectionCount}`)
  if (fields.affectedRequestIds.length > 0) {
    const preview = fields.affectedRequestIds.slice(0, 8).join(',')
    const suffix = fields.affectedRequestIds.length > 8 ? '...' : ''
    parts.push(`affected_rids=${preview}${suffix}`)
    parts.push(`affected_rid_count=${fields.affectedRequestIds.length}`)
  }
  return `${parts.join(' ')}\n`
}
