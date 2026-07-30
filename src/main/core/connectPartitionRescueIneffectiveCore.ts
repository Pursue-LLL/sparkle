// [INPUT] CONNECT_PARTITION_MIN_PING_FAILURES from connectPartitionDetectCore
// [OUTPUT] evaluateConnectPartitionRescueIneffective · formatConnectPartitionRescueIneffectiveLogLine
// [POS] R-31 SSOT — connect_partition rescue executed but mass PING / partition signal persists while short path green.

import { CONNECT_PARTITION_MIN_PING_FAILURES } from './connectPartitionDetectCore'

export const CONNECT_PARTITION_RESCUE_INEFFECTIVE_KIND =
  'connect_partition_rescue_ineffective' as const

export interface ConnectPartitionRescueExecutionRecord {
  executedAtMs: number
  outcome: string
  staleRequestIds: readonly string[]
  pingFailureCountAtRescue: number
  connectPathPartitionStale: boolean
}

export interface ConnectPartitionRescueIneffectiveObservation {
  pingFailureCount: number
  pingFailureCountAtRescue: number
  staleRequestIds: readonly string[]
  connectPathPartitionStale: number
  api2DelayMs?: number
  executedAtMs: number
  elapsedSinceRescueMs: number
}

export function shouldRecordConnectPartitionRescueExecution(outcome: string): boolean {
  return outcome === 'executed'
}

export function evaluateConnectPartitionRescueIneffective(input: {
  record: ConnectPartitionRescueExecutionRecord | undefined
  nowMs: number
  pingFailureCount: number
  staleRequestIds: readonly string[]
  connectPathPartitionStale: boolean
  api2DelayMs?: number
  minElapsedMs?: number
}): ConnectPartitionRescueIneffectiveObservation | undefined {
  const record = input.record
  if (!record || !shouldRecordConnectPartitionRescueExecution(record.outcome)) {
    return undefined
  }
  const minElapsedMs = input.minElapsedMs ?? 5_000
  const elapsedSinceRescueMs = input.nowMs - record.executedAtMs
  if (elapsedSinceRescueMs < minElapsedMs) {
    return undefined
  }
  if (input.connectPathPartitionStale) {
    return undefined
  }
  if (input.pingFailureCount < CONNECT_PARTITION_MIN_PING_FAILURES) {
    return undefined
  }
  if (input.pingFailureCount < record.pingFailureCountAtRescue) {
    return undefined
  }
  return {
    pingFailureCount: input.pingFailureCount,
    pingFailureCountAtRescue: record.pingFailureCountAtRescue,
    staleRequestIds:
      input.staleRequestIds.length > 0 ? input.staleRequestIds : record.staleRequestIds,
    connectPathPartitionStale: 0,
    api2DelayMs: input.api2DelayMs,
    executedAtMs: record.executedAtMs,
    elapsedSinceRescueMs,
  }
}

export function formatConnectPartitionRescueIneffectiveLogLine(
  observation: ConnectPartitionRescueIneffectiveObservation,
): string {
  const stalePreview = observation.staleRequestIds.slice(0, 5).join(',')
  const parts = [
    '[ConnectPartitionRescueIneffective]:',
    'outcome=observed',
    'observe_only=true',
    `ping_failures=${observation.pingFailureCount}`,
    `ping_failures_at_rescue=${observation.pingFailureCountAtRescue}`,
    'connect_path_partition_stale=0',
    `elapsed_since_rescue_ms=${observation.elapsedSinceRescueMs}`,
    `stale_rids=${stalePreview}`,
  ]
  if (observation.api2DelayMs != null) {
    parts.push(`api2_delay_ms=${observation.api2DelayMs}`)
  }
  return `${parts.join(' ')}\n`
}
