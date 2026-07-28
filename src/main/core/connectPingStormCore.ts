// [INPUT] connectPartitionDetectCore · vpsCanonicalNodes · vpsL4ProbeCore interval
// [OUTPUT] mergeConnectPartitionSignals · buildSyntheticConnectPartitionSignal · resolveRecentVpsL4OkForNode
// [POS] P16: ultra-conn QUIC saturation — jsonl + synthetic partition + ultra_conn observability SSOT.

import type { Api2ProbeLedgerRow } from './api2ProbeLedgerRowCore'
import {
  CONNECT_PARTITION_MIN_PING_FAILURES,
  CONNECT_PARTITION_WINDOW_MS,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'
import { CURSOR_HY2_NUDGE_DEFER_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import { resolveVpsRegionFromLeafNode } from './vpsCanonicalNodes'
import { VPS_L4_PROBE_INTERVAL_MS } from './vpsL4ProbeCore'

export const CONNECT_PING_STORM_ULTRA_CONN_THRESHOLD = 200
export const CONNECT_PING_STORM_SYNTHETIC_DEFER_STREAK = 2
export const LATENCY_DELTA_RESCUE_STREAK_CYCLES = 2
export const VPS_L4_OK_LOOKBACK_MS = VPS_L4_PROBE_INTERVAL_MS + 60_000

export type ConnectPartitionSignalSource = 'jsonl' | 'synthetic'

export interface ConnectPartitionSignalWithSource extends ConnectPartitionSignal {
  source: ConnectPartitionSignalSource
}

export function isNetworkDiagnosticTransportLine(line: string): boolean {
  return /Network Diagnostic|networkDiagnostics|network.?diagnostic|cursorNetworkDiagnostics/i.test(line)
}

export function mergeConnectPartitionSignals(
  jsonlSignal: ConnectPartitionSignal | undefined,
  syntheticSignal: ConnectPartitionSignalWithSource | undefined,
): ConnectPartitionSignalWithSource | undefined {
  if (jsonlSignal) {
    return { ...jsonlSignal, source: 'jsonl' }
  }
  return syntheticSignal
}

export function buildSyntheticConnectPartitionSignal(
  cursorConnectionCount: number,
): ConnectPartitionSignalWithSource {
  return {
    pingFailureCount: CONNECT_PARTITION_MIN_PING_FAILURES,
    windowMs: CONNECT_PARTITION_WINDOW_MS,
    cursorConnectionCount,
    sampleRequestIds: ['synthetic_partition_stale'],
    source: 'synthetic',
  }
}

export function shouldEmitSyntheticConnectPartition(
  cursorConnectionCount: number,
  consecutiveWarmthDeferredCount: number,
  vpsL4Ok: boolean,
  jsonlSignalPresent: boolean,
): boolean {
  if (jsonlSignalPresent) {
    return false
  }
  return (
    cursorConnectionCount >= CURSOR_HY2_NUDGE_DEFER_THRESHOLD &&
    consecutiveWarmthDeferredCount >= CONNECT_PING_STORM_SYNTHETIC_DEFER_STREAK &&
    vpsL4Ok
  )
}

export function resolveRecentVpsL4OkForNode(
  rows: readonly Api2ProbeLedgerRow[],
  nodeName: string,
  nowMs: number,
  maxAgeMs: number = VPS_L4_OK_LOOKBACK_MS,
): boolean {
  const regionKey = resolveVpsRegionFromLeafNode(nodeName.trim())
  if (!regionKey) {
    return false
  }
  const sinceMs = nowMs - maxAgeMs
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!
    if (row.scope !== 'vps' || row.method !== 'ssh_curl' || row.node !== regionKey) {
      continue
    }
    const ts = Date.parse(row.ts)
    if (!Number.isFinite(ts) || ts < sinceMs) {
      continue
    }
    return row.ok === true && (row.latency_ms ?? 0) > 0
  }
  return false
}

export function shouldEmitUltraConnObservability(cursorConnectionCount: number): boolean {
  return cursorConnectionCount >= CONNECT_PING_STORM_ULTRA_CONN_THRESHOLD
}

export function formatUltraConnObservabilityLine(fields: {
  cursorConnectionCount: number
  deferredCount: number
  vpsL4Ok: boolean
}): string {
  return (
    `[UltraConnObservability]: cursor_conn=${fields.cursorConnectionCount}` +
    ` deferred_count=${fields.deferredCount}` +
    ` vps_l4_ok=${fields.vpsL4Ok ? 1 : 0}\n`
  )
}

export function shouldCountWarmthDeferStreak(
  cursorConnectionCount: number,
  outcome: string,
  trigger: string,
): boolean {
  if (cursorConnectionCount < CURSOR_HY2_NUDGE_DEFER_THRESHOLD) {
    return false
  }
  if (outcome !== 'skipped_deferred') {
    return false
  }
  return trigger === 'periodic_session' || trigger === 'high_latency_warmth'
}

export function nextWarmthDeferStreak(
  current: number,
  counted: boolean,
): number {
  return counted ? current + 1 : 0
}

export function nextLatencyDeltaRescueStreak(current: number, deltaHigh: boolean): number {
  return deltaHigh ? current + 1 : 0
}

export function isLatencyDeltaRescueEligible(streak: number): boolean {
  return streak >= LATENCY_DELTA_RESCUE_STREAK_CYCLES
}
