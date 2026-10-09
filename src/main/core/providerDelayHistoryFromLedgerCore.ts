// [INPUT] api2ProbeLedgerRowCore
// [OUTPUT] ledgerRowsToProviderDelayHistory · LEDGER_PROVIDER_DELAY_METHODS
// [POS] P11: Marathon UI delay chart backfill from api2-probe-ledger (zero extra dial).

import type { Api2ProbeLedgerRow } from './api2ProbeLedgerRowCore'

export interface ProviderDelayHistoryFromLedgerEntry {
  time: string
  delay: number
}

/** Mac full path chart: transport_pair only — session_nudge spikes are observability artifacts (§17.4). */
export const LEDGER_PROVIDER_DELAY_HISTORY_METHODS = new Set(['transport_pair'])

export const LEDGER_PROVIDER_DELAY_HISTORY_LIMIT = 8

export const LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS = 24 * 60 * 60 * 1000

export function ledgerRowsToProviderDelayHistory(
  rows: readonly Api2ProbeLedgerRow[],
  nodeName: string,
  limit: number = LEDGER_PROVIDER_DELAY_HISTORY_LIMIT,
): ProviderDelayHistoryFromLedgerEntry[] {
  const normalizedNode = nodeName.trim()
  if (!normalizedNode || limit <= 0) {
    return []
  }

  const samples: ProviderDelayHistoryFromLedgerEntry[] = []
  for (const row of rows) {
    if (row.scope !== 'active' || row.node !== normalizedNode) {
      continue
    }
    if (!row.ok || row.latency_ms <= 0) {
      continue
    }
    if (!LEDGER_PROVIDER_DELAY_HISTORY_METHODS.has(row.method)) {
      continue
    }
    samples.push({ time: row.ts, delay: row.latency_ms })
  }

  return samples.slice(-limit)
}

/** 从 ledger 行批量折算节点 → 延迟中位数（与 UI 柱图同源：active + transport_pair）。 */
export function buildNodeDelayMapFromLedgerRows(
  rows: readonly Api2ProbeLedgerRow[],
): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const row of rows) {
    if (row.scope !== 'active' || !row.ok || row.latency_ms <= 0) {
      continue
    }
    if (!LEDGER_PROVIDER_DELAY_HISTORY_METHODS.has(row.method)) {
      continue
    }
    const list = buckets.get(row.node) ?? []
    list.push(row.latency_ms)
    buckets.set(row.node, list)
  }
  const delays = new Map<string, number>()
  for (const [node, samples] of buckets) {
    const recent = samples.slice(-LEDGER_PROVIDER_DELAY_HISTORY_LIMIT)
    const sorted = [...recent].sort((a, b) => a - b)
    delays.set(node, sorted[Math.floor(sorted.length / 2)]!)
  }
  return delays
}
