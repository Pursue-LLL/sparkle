// [INPUT] api2ProbeLedgerRowCore
// [OUTPUT] ledgerRowsToLatencyTruthSummary · isVpsBodyBenchmarkLedgerRow · computeDelayP50
// [POS] P13 Phase 2 Latency Truth: VPS body (scope=vps ssh_curl) vs Mac full path (scope=active transport_pair).

import type { Api2ProbeLedgerRow } from './api2ProbeLedgerRowCore'
import { resolveVpsRegionFromLeafNode } from './vpsCanonicalNodes'

export const VPS_BODY_BENCHMARK_METHOD = 'ssh_curl' as const
export const MAC_FULL_PATH_LATENCY_METHOD = 'transport_pair' as const

export interface LatencyTruthSummary {
  vpsBodyP50: number | null
  vpsBodySamples: number
  /** ISO timestamp of the newest VPS ssh_curl body sample in the lookback window. */
  vpsBodyLastTs: string | null
  macFullPathP50: number | null
  macFullPathSamples: number
  /** ISO timestamp of the newest Mac full-path transport sample in the lookback window. */
  macFullPathLastTs: string | null
}

function pickLatestIsoTs(current: string | null, candidate: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed) {
    return current
  }
  const candidateMs = Date.parse(trimmed)
  if (!Number.isFinite(candidateMs)) {
    return current
  }
  if (!current) {
    return trimmed
  }
  const currentMs = Date.parse(current)
  if (!Number.isFinite(currentMs)) {
    return trimmed
  }
  return candidateMs >= currentMs ? trimmed : current
}

export function computeDelayP50(delays: readonly number[]): number | null {
  if (delays.length === 0) {
    return null
  }
  const sorted = [...delays].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  return sorted[mid]!
}

export function isVpsBodyBenchmarkLedgerRow(row: Api2ProbeLedgerRow): boolean {
  return (
    row.scope === 'vps' &&
    row.method === VPS_BODY_BENCHMARK_METHOD &&
    row.ok &&
    row.latency_ms > 0 &&
    row.authoritative !== false
  )
}

export const MAC_FULL_PATH_LATENCY_METHODS = new Set<Api2ProbeLedgerRow['method']>([
  MAC_FULL_PATH_LATENCY_METHOD,
  'marathon_connect_path_pulse',
])

export function isMacFullPathLatencyLedgerRow(row: Api2ProbeLedgerRow): boolean {
  return (
    row.scope === 'active' &&
    MAC_FULL_PATH_LATENCY_METHODS.has(row.method) &&
    row.ok &&
    row.latency_ms > 0 &&
    row.authoritative !== false
  )
}

export function ledgerRowsToLatencyTruthSummary(
  rows: readonly Api2ProbeLedgerRow[],
  nodeName: string,
): LatencyTruthSummary {
  const normalizedNode = nodeName.trim()
  if (!normalizedNode) {
    return {
      vpsBodyP50: null,
      vpsBodySamples: 0,
      vpsBodyLastTs: null,
      macFullPathP50: null,
      macFullPathSamples: 0,
      macFullPathLastTs: null,
    }
  }

  const vpsRegionKey = resolveVpsRegionFromLeafNode(normalizedNode)
  const vpsDelays: number[] = []
  const macDelays: number[] = []
  let vpsBodyLastTs: string | null = null
  let macFullPathLastTs: string | null = null
  for (const row of rows) {
    if (isVpsBodyBenchmarkLedgerRow(row)) {
      if (vpsRegionKey && row.node === vpsRegionKey) {
        vpsDelays.push(row.latency_ms)
        vpsBodyLastTs = pickLatestIsoTs(vpsBodyLastTs, row.ts)
      }
      continue
    }
    if (row.node !== normalizedNode) {
      continue
    }
    if (isMacFullPathLatencyLedgerRow(row)) {
      macDelays.push(row.latency_ms)
      macFullPathLastTs = pickLatestIsoTs(macFullPathLastTs, row.ts)
    }
  }

  return {
    vpsBodyP50: computeDelayP50(vpsDelays),
    vpsBodySamples: vpsDelays.length,
    vpsBodyLastTs,
    macFullPathP50: computeDelayP50(macDelays),
    macFullPathSamples: macDelays.length,
    macFullPathLastTs,
  }
}
