// [INPUT] MarathonSSETruthResult · mihomo connection snapshots
// [OUTPUT] buildTransportLongevityTruth · formatTransportLongevityTruthLogLine
// [POS] R-34a SSOT — three independent age axes (HTTP parent · HY2 outbound session · byte stall).

import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import type { MihomoQuicStallTrackedConnection } from './mihomoQuicSilentStallCore'
import {
  resolveMarathonQuIcLeafFromChains,
} from './mihomoQuicSilentStallCore'
export const TRANSPORT_LONGEVITY_TRUTH_FILENAME = 'transport-longevity-truth.json'
export const TRANSPORT_LONGEVITY_TRUTH_SCHEMA_VERSION = 2
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
  /** Monotonic HY2 parent chain birth — survives SSE segment reset (R-40). */
  hy2ParentChainBirthMs?: number
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

export function resolvePersistedHy2ParentChainAgeMs(input: {
  nowMs: number
  activeHy2Leaf: string
  previousSnapshot: TransportLongevityTruthSnapshot | undefined
  computedHttpParentChainAgeMs: number
  computedOutboundHy2SessionAgeMs: number
}): {
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  hy2ParentChainBirthMs: number
} {
  const computedMax = Math.max(
    input.computedHttpParentChainAgeMs,
    input.computedOutboundHy2SessionAgeMs,
  )
  const previous = input.previousSnapshot
  const sameLeaf = previous?.activeHy2Leaf === input.activeHy2Leaf
  let birthMs = sameLeaf ? (previous?.hy2ParentChainBirthMs ?? 0) : 0
  const explicitBirthReset =
    sameLeaf &&
    previous?.hy2ParentChainBirthMs != null &&
    previous.hy2ParentChainBirthMs > 0 &&
    previous.httpParentChainAgeMs === 0 &&
    previous.outboundHy2SessionAgeMs === 0

  if (birthMs <= 0) {
    birthMs = computedMax > 0 ? input.nowMs - computedMax : input.nowMs
  } else if (!explicitBirthReset && computedMax > 0) {
    birthMs = Math.min(birthMs, input.nowMs - computedMax)
  }

  const persistedAgeMs = Math.max(0, input.nowMs - birthMs)
  const minAgeFromBirth =
    birthMs > 0 && input.nowMs - birthMs > 1_000 ? persistedAgeMs : 0
  if (explicitBirthReset) {
    return {
      httpParentChainAgeMs: Math.max(persistedAgeMs, minAgeFromBirth),
      outboundHy2SessionAgeMs: Math.max(persistedAgeMs, minAgeFromBirth),
      hy2ParentChainBirthMs: birthMs,
    }
  }
  return {
    httpParentChainAgeMs: Math.max(
      input.computedHttpParentChainAgeMs,
      persistedAgeMs,
      minAgeFromBirth,
    ),
    outboundHy2SessionAgeMs: Math.max(
      input.computedOutboundHy2SessionAgeMs,
      persistedAgeMs,
      minAgeFromBirth,
    ),
    hy2ParentChainBirthMs: birthMs,
  }
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
  previousSnapshot?: TransportLongevityTruthSnapshot
}): TransportLongevityTruthSnapshot {
  const computedHttpParentChainAgeMs = input.marathonTruth.maxParentChainAgeMs
  const computedOutboundHy2SessionAgeMs = resolveOutboundHy2SessionAgeMs({
    connections: input.connections,
    trackedById: input.trackedById,
    activeLeaf: input.activeHy2Leaf,
    nowMs: input.nowMs,
  })
  const persisted = resolvePersistedHy2ParentChainAgeMs({
    nowMs: input.nowMs,
    activeHy2Leaf: input.activeHy2Leaf,
    previousSnapshot: input.previousSnapshot,
    computedHttpParentChainAgeMs,
    computedOutboundHy2SessionAgeMs,
  })
  return {
    schemaVersion: TRANSPORT_LONGEVITY_TRUTH_SCHEMA_VERSION,
    updatedAtMs: input.nowMs,
    cursorConnectionCount: input.cursorConnectionCount,
    httpParentChainAgeMs: persisted.httpParentChainAgeMs,
    outboundHy2SessionAgeMs: persisted.outboundHy2SessionAgeMs,
    hy2ParentChainBirthMs: persisted.hy2ParentChainBirthMs,
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
    (snapshot.hy2ParentChainBirthMs != null
      ? ` hy2_parent_chain_birth_ms=${snapshot.hy2ParentChainBirthMs}`
      : '') +
    ` max_byte_stall_ms=${snapshot.maxByteStallMs}` +
    ` frozen_quic_cursor=${snapshot.frozenQuicCursorCount}` +
    ` cursor_conn=${snapshot.cursorConnectionCount}` +
    ` leaf=${snapshot.activeHy2Leaf}\n`
  )
}

export function isHy2ParentRotationDue(snapshot: TransportLongevityTruthSnapshot): boolean {
  return snapshot.outboundHy2SessionAgeMs >= HY2_PARENT_ROTATE_AGE_MS
}
