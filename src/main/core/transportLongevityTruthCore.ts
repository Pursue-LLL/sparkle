// [INPUT] MarathonSSETruthResult · mihomo connection snapshots
// [OUTPUT] buildTransportLongevityTruth · formatTransportLongevityTruthLogLine
// [POS] R-34a SSOT — three independent age axes (HTTP parent · HY2 outbound session · byte stall).

import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import type { MihomoQuicStallTrackedConnection } from './mihomoQuicSilentStallCore'
import {
  resolveMarathonQuIcLeafFromChains,
} from './mihomoQuicSilentStallCore'
export const TRANSPORT_LONGEVITY_TRUTH_FILENAME = 'transport-longevity-truth.json'
export const HY2_PARENT_ROTATE_AGE_MS = 18 * 60 * 60 * 1000

export interface TransportLongevityTruthSnapshot {
  schemaVersion: number
  updatedAtMs: number
  cursorConnectionCount: number
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  maxByteStallMs: number
  frozenQuicCursorCount: number
  activeHy2Leaf: string
}

export function resolveOutboundHy2SessionAgeMs(input: {
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  activeLeaf: string
  nowMs: number
}): number {
  let oldestFirstSeenMs: number | undefined
  for (const connection of input.connections) {
    const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? [])
    if (leaf !== input.activeLeaf) {
      continue
    }
    const network = String(connection.metadata?.network ?? '')
    if (network !== 'udp') {
      continue
    }
    const tracked = input.trackedById.get(connection.id)
    const firstSeenMs = tracked?.firstSeenAtMs ?? input.nowMs
    oldestFirstSeenMs =
      oldestFirstSeenMs == null ? firstSeenMs : Math.min(oldestFirstSeenMs, firstSeenMs)
  }
  if (oldestFirstSeenMs == null) {
    return 0
  }
  return Math.max(0, input.nowMs - oldestFirstSeenMs)
}

export function buildTransportLongevityTruth(input: {
  nowMs: number
  cursorConnectionCount: number
  marathonTruth: MarathonSSETruthResult
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  activeHy2Leaf: string
  maxByteStallMs: number
  frozenQuicCursorCount: number
}): TransportLongevityTruthSnapshot {
  return {
    schemaVersion: TRANSPORT_LONGEVITY_TRUTH_SCHEMA_VERSION,
    updatedAtMs: input.nowMs,
    cursorConnectionCount: input.cursorConnectionCount,
    httpParentChainAgeMs: input.marathonTruth.maxParentChainAgeMs,
    outboundHy2SessionAgeMs: resolveOutboundHy2SessionAgeMs({
      connections: input.connections,
      trackedById: input.trackedById,
      activeLeaf: input.activeHy2Leaf,
      nowMs: input.nowMs,
    }),
    maxByteStallMs: Math.max(0, Math.round(input.maxByteStallMs)),
    frozenQuicCursorCount: Math.max(0, Math.round(input.frozenQuicCursorCount)),
    activeHy2Leaf: input.activeHy2Leaf,
  }
}

export function formatTransportLongevityTruthLogLine(snapshot: TransportLongevityTruthSnapshot): string {
  return (
    `[TransportLongevityTruth]:` +
    ` http_parent_chain_age_ms=${snapshot.httpParentChainAgeMs}` +
    ` outbound_hy2_session_age_ms=${snapshot.outboundHy2SessionAgeMs}` +
    ` max_byte_stall_ms=${snapshot.maxByteStallMs}` +
    ` frozen_quic_cursor=${snapshot.frozenQuicCursorCount}` +
    ` cursor_conn=${snapshot.cursorConnectionCount}` +
    ` leaf=${snapshot.activeHy2Leaf}\n`
  )
}

export function isHy2ParentRotationDue(snapshot: TransportLongevityTruthSnapshot): boolean {
  return snapshot.outboundHy2SessionAgeMs >= HY2_PARENT_ROTATE_AGE_MS
}
