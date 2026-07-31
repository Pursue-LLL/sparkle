// [INPUT] NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS from hy2TunnelVitalityCore
// [OUTPUT] evaluateTokenGapRescueIneffective · formatTokenGapRescueIneffectiveLogLine
// [POS] R-18 SSOT — rescue executed_on_stale_rid but max_gap still high + partition_stale=0.

import { NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS } from './hy2TunnelVitalityCore'

export const TOKEN_GAP_RESCUE_INEFFECTIVE_KIND = 'token_gap_rescue_ineffective' as const

export interface TokenGapRescueExecutionRecord {
  executedAtMs: number
  outcome: string
  maxGapMs: number
  staleRequestIds: readonly string[]
  partitionStale: boolean
}

export interface TokenGapRescueIneffectiveObservation {
  maxGapMs: number
  staleRequestIds: readonly string[]
  partitionStale: number
  api2DelayMs?: number
  executedAtMs: number
  elapsedSinceRescueMs: number
}

export function shouldRecordTokenGapRescueExecution(outcome: string): boolean {
  return (
    outcome === 'attempted_on_stale_rid' ||
    outcome === 'executed_on_stale_rid' ||
    outcome === 'executed'
  )
}

export function evaluateTokenGapRescueIneffective(input: {
  record: TokenGapRescueExecutionRecord | undefined
  nowMs: number
  maxGapMs: number
  staleRequestIds: readonly string[]
  partitionStale: boolean
  api2DelayMs?: number
  minGapMs?: number
}): TokenGapRescueIneffectiveObservation | undefined {
  const record = input.record
  if (!record) {
    return undefined
  }
  if (!shouldRecordTokenGapRescueExecution(record.outcome)) {
    return undefined
  }
  const minGapMs = input.minGapMs ?? NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS
  if (input.partitionStale) {
    return undefined
  }
  if (input.maxGapMs <= minGapMs) {
    return undefined
  }
  const elapsedSinceRescueMs = input.nowMs - record.executedAtMs
  if (elapsedSinceRescueMs < 5_000) {
    return undefined
  }
  return {
    maxGapMs: input.maxGapMs,
    staleRequestIds: input.staleRequestIds.length > 0 ? input.staleRequestIds : record.staleRequestIds,
    partitionStale: 0,
    api2DelayMs: input.api2DelayMs,
    executedAtMs: record.executedAtMs,
    elapsedSinceRescueMs,
  }
}

export function formatTokenGapRescueIneffectiveLogLine(
  observation: TokenGapRescueIneffectiveObservation,
): string {
  const stalePreview = observation.staleRequestIds.slice(0, 5).join(',')
  const parts = [
    '[TokenGapRescueIneffective]:',
    'outcome=observed',
    'observe_only=true',
    `max_gap_ms=${observation.maxGapMs}`,
    'partition_stale=0',
    `elapsed_since_rescue_ms=${observation.elapsedSinceRescueMs}`,
    `stale_rids=${stalePreview}`,
  ]
  if (observation.api2DelayMs != null) {
    parts.push(`api2_delay_ms=${observation.api2DelayMs}`)
  }
  return `${parts.join(' ')}\n`
}
