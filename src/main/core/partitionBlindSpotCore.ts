// [INPUT] connectPartitionDetectCore thresholds
// [OUTPUT] shouldEmitPartitionBlindSpot · formatPartitionBlindSpotLogLine
// [POS] P18 — jsonl empty while Structured mass-PING visible → app-log alert (no dial, no conn kill).

import {
  CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS,
  CONNECT_PARTITION_MIN_PING_FAILURES,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'

export const PARTITION_BLIND_SPOT_COOLDOWN_MS = 60_000

export function shouldEmitPartitionBlindSpot(options: {
  cursorConnectionCount: number
  structuredPingCount: number
  jsonlPingCount: number
  nowMs: number
  lastEmittedAtMs: number
}): boolean {
  if (options.cursorConnectionCount < CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS) {
    return false
  }
  if (options.structuredPingCount < CONNECT_PARTITION_MIN_PING_FAILURES) {
    return false
  }
  if (options.jsonlPingCount > 0) {
    return false
  }
  if (options.nowMs - options.lastEmittedAtMs < PARTITION_BLIND_SPOT_COOLDOWN_MS) {
    return false
  }
  return true
}

export function formatPartitionBlindSpotLogLine(fields: {
  structuredPingCount: number
  jsonlPingCount: number
  cursorConnectionCount: number
  logRoots: number
  structuredFiles: number
  mergedRows: number
  dedupedRows: number
  partitionDetected: boolean
  sampleRequestIds: readonly string[]
}): string {
  const sample =
    fields.sampleRequestIds.length > 0 ? fields.sampleRequestIds.slice(0, 3).join(',') : '-'
  return (
    `[PartitionBlindSpot]: structured_ping=${fields.structuredPingCount}` +
    ` jsonl_ping=${fields.jsonlPingCount}` +
    ` cursor_conn=${fields.cursorConnectionCount}` +
    ` roots=${fields.logRoots}` +
    ` structured_files=${fields.structuredFiles}` +
    ` merged_rows=${fields.mergedRows}` +
    ` deduped=${fields.dedupedRows}` +
    ` partition=${fields.partitionDetected ? 1 : 0}` +
    ` sample_rids=${sample}\n`
  )
}

export function formatCursorLogPlaneLine(fields: {
  logRoots: number
  structuredFiles: number
  mergedRows: number
  dedupedRows: number
  partitionDetected: boolean
  cursorConnectionCount: number
}): string {
  return (
    `[CursorLogPlane]: roots=${fields.logRoots}` +
    ` structured_files=${fields.structuredFiles}` +
    ` merged_rows=${fields.mergedRows}` +
    ` deduped=${fields.dedupedRows}` +
    ` partition=${fields.partitionDetected ? 1 : 0}` +
    ` cursor_conn=${fields.cursorConnectionCount}\n`
  )
}

export function partitionDetected(signal: ConnectPartitionSignal | undefined): boolean {
  return signal != null
}
