// [INPUT] agentTransportFailureWriterCore::rowDedupeKey
// [OUTPUT] mergeTransportFailureRows · countConnectPingFailuresInWindow
// [POS] P18 SSOT — structured hot + jsonl tail → deduped rows for partition detect / blind-spot metrics.

import {
  isConnectPingTransportFailure,
  resolveConnectPartitionWindowMs,
  type AgentTransportFailureRow,
} from './connectPartitionDetectCore'
import { rowDedupeKey } from './agentTransportFailureWriterCore'

function parseFailureTs(raw: number | string | undefined): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

/** Merge transport failure rows from any source; later duplicates (same dedupe key) are dropped. */
export function mergeTransportFailureRows(
  ...sources: readonly (readonly AgentTransportFailureRow[])[]
): AgentTransportFailureRow[] {
  const seen = new Set<string>()
  const merged: AgentTransportFailureRow[] = []
  for (const source of sources) {
    for (const row of source) {
      const ts = parseFailureTs(row.ts)
      if (ts === undefined) {
        continue
      }
      const normalized: AgentTransportFailureRow = { ...row, ts }
      const key = rowDedupeKey(normalized)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      merged.push(normalized)
    }
  }
  return merged
}

export function countConnectPingFailuresInWindow(
  rows: readonly AgentTransportFailureRow[],
  nowMs: number,
  cursorConnectionCount: number,
): number {
  const windowMs = resolveConnectPartitionWindowMs(cursorConnectionCount)
  const sinceMs = nowMs - windowMs
  let count = 0
  for (const row of rows) {
    if (!isConnectPingTransportFailure(row)) {
      continue
    }
    const ts = parseFailureTs(row.ts)
    if (ts === undefined || ts < sinceMs || ts > nowMs + 1_000) {
      continue
    }
    count += 1
  }
  return count
}
