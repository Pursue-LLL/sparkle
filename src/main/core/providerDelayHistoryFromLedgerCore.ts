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
