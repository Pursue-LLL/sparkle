// [INPUT] LatencyTruthSummary · LatencyDeltaGateResult
// [OUTPUT] formatLatencyTruthGateLogLine · resolveSparkleLatencyTaxFlag
// [POS] P20a SSOT: ledger dual-track observability + triage SPARKLE_LATENCY_TAX.

import type { LatencyDeltaGateResult } from './latencyDeltaGateCore'
import type { LatencyTruthSummary } from './latencyTruthFromLedgerCore'

export function formatLatencyTruthGateLogLine(
  nodeName: string,
  summary: LatencyTruthSummary,
  gate: LatencyDeltaGateResult,
): string {
  const macP50 = summary.macFullPathP50 == null ? 'null' : String(Math.round(summary.macFullPathP50))
  const vpsP50 = summary.vpsBodyP50 == null ? 'null' : String(Math.round(summary.vpsBodyP50))
  const deltaMs = gate.deltaMs == null ? 'null' : String(Math.round(gate.deltaMs))
  return (
    `[LatencyTruth]: node=${nodeName}` +
    ` mac_p50=${macP50} mac_n=${summary.macFullPathSamples}` +
    ` vps_p50=${vpsP50} vps_n=${summary.vpsBodySamples}` +
    ` delta_ms=${deltaMs} high=${gate.high ? 1 : 0}`
  )
}

export function resolveSparkleLatencyTaxFlag(gate: LatencyDeltaGateResult): 0 | 1 {
  return gate.high ? 1 : 0
}
