// [INPUT] HUNG_SCAN_INTERVAL_MS from cursorTransportHealthCore
// [OUTPUT] armPartitionLatch · resolvePartitionLatchCandidate · partitionLatchActive
// [POS] P19 — force connect_partition candidate after blind_spot or structured mass-PING miss.

import { HUNG_SCAN_INTERVAL_MS } from './cursorTransportHealthCore'
import {
  CONNECT_PARTITION_MIN_PING_FAILURES,
  isConnectPingTransportFailure,
  type AgentTransportFailureRow,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'
import type { MarathonTransportDialCandidate } from './marathonTransportDialOrchestratorCore'

const LATCH_SCAN_MULTIPLIER = 2

let partitionLatchUntilMs = 0

export function resetPartitionLatchStateForTests(): void {
  partitionLatchUntilMs = 0
}

export function partitionLatchActive(nowMs: number): boolean {
  return partitionLatchUntilMs > nowMs
}

export function clearPartitionLatch(): void {
  partitionLatchUntilMs = 0
}

export function armPartitionLatch(nowMs: number): void {
  partitionLatchUntilMs = nowMs + LATCH_SCAN_MULTIPLIER * HUNG_SCAN_INTERVAL_MS
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
    staleRequestIdCount: 0,
    staleRequestIds: [],
  }
}
