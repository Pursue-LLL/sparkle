// [INPUT] LatencyTruthSummary · MTDO thresholds
// [OUTPUT] evaluateLatencyDeltaFromSummary
// [POS] §22 MTDO: Mac full path vs VPS body delta observability (no failover).

import type { LatencyTruthSummary } from './latencyTruthFromLedgerCore'
import {
  MTDO_LATENCY_DELTA_MIN_SAMPLES,
  MTDO_LATENCY_DELTA_THRESHOLD_MS,
} from './marathonTransportDialOrchestratorCore'

export interface LatencyDeltaGateResult {
  high: boolean
  summary: LatencyTruthSummary
  deltaMs: number | null
}

export function evaluateLatencyDeltaFromSummary(summary: LatencyTruthSummary): LatencyDeltaGateResult {
  if (
    summary.vpsBodyP50 == null ||
    summary.macFullPathP50 == null ||
    summary.vpsBodySamples < MTDO_LATENCY_DELTA_MIN_SAMPLES ||
    summary.macFullPathSamples < MTDO_LATENCY_DELTA_MIN_SAMPLES
  ) {
    return { high: false, summary, deltaMs: null }
  }
  const deltaMs = summary.macFullPathP50 - summary.vpsBodyP50
  return {
    high: deltaMs > MTDO_LATENCY_DELTA_THRESHOLD_MS,
    summary,
    deltaMs,
  }
}
