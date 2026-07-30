// [INPUT] cursorCriticalTransportCore · cursorHy2MarathonKeepaliveCore
// [OUTPUT] scanMihomoQuicSilentStalls · formatMihomoQuicSilentStallLogLine
// [POS] R-17 SSOT — observe-only HY2/TUIC QUIC byte-frozen stall triage (no recovery, no failover).

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  isMarathonQuIcInboundCursorNode,
} from './cursorHy2MarathonKeepaliveCore'

/** Bytes unchanged this long on an aged QUIC Cursor flow → silent stall suspect. */
export const MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS = 45_000

/** Ignore brand-new flows — tool pauses can legitimately idle briefly. */
export const MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS = 90_000

/** Only scan during marathon-scale Cursor load. */
export const MIHOMO_QUIC_STALL_MARATHON_CONN_THRESHOLD = CURSOR_HY2_MARATHON_CONN_THRESHOLD

/** Per (leaf, host) emit cooldown — avoids WS spam @ 500ms interval. */
export const MIHOMO_QUIC_STALL_EMIT_COOLDOWN_MS = 120_000

/** Aggregate window emit cooldown — correlates with mass PING partition precursors. */
export const MIHOMO_QUIC_STALL_AGGREGATE_EMIT_COOLDOWN_MS = 60_000

/** Frozen QUIC critical-host flows in one snapshot → aggregate stall window. */
export const MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN = 5

export const MIHOMO_QUIC_STALL_AGGREGATE_CONN_THRESHOLD = 80

export interface MihomoQuicStallTrackedConnection {
  upload: number
  download: number
  lastBytesChangeAtMs: number
  firstSeenAtMs: number
  host: string
  leaf: string
  network: string
}

export interface MihomoQuicSilentStallObservation {
  kind: 'single' | 'aggregate'
  connectionId?: string
  host?: string
  leaf: string
  network?: string
  stallMs: number
  connAgeMs?: number
  upload?: number
  download?: number
  frozenQuicCursorCount: number
  totalQuicCursorCount: number
  cursorConnectionCount: number
}

export function resolveConnectionHost(connection: ControllerConnectionDetail): string {
  const metadata = connection.metadata ?? ({} as ControllerConnectionDetail['metadata'])
  return String(metadata.host ?? metadata.sniffHost ?? metadata.remoteDestination ?? '').trim()
}

export function resolveMarathonQuIcLeafFromChains(chains: readonly string[]): string | undefined {
  for (const chain of chains) {
    const trimmed = chain.trim()
    if (isMarathonQuIcInboundCursorNode(trimmed)) {
      return trimmed
    }
  }
  return undefined
}

export function isMarathonQuIcCursorTransportConnection(
  connection: ControllerConnectionDetail,
): boolean {
  const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? [])
  if (!leaf) {
    return false
  }
  const metadata = connection.metadata ?? ({} as ControllerConnectionDetail['metadata'])
  if (metadata.network === 'udp') {
    return true
  }
  return isCriticalCursorHost(resolveConnectionHost(connection))
}

export function updateMihomoQuicStallTrackedConnection(
  tracked: MihomoQuicStallTrackedConnection,
  connection: ControllerConnectionDetail,
  nowMs: number,
): MihomoQuicStallTrackedConnection {
  const upload = connection.upload ?? 0
  const download = connection.download ?? 0
  const bytesChanged = upload !== tracked.upload || download !== tracked.download
  return {
    ...tracked,
    upload,
    download,
    lastBytesChangeAtMs: bytesChanged ? nowMs : tracked.lastBytesChangeAtMs,
    host: resolveConnectionHost(connection) || tracked.host,
    network: String(connection.metadata?.network ?? tracked.network),
  }
}

export function createMihomoQuicStallTrackedConnection(
  connection: ControllerConnectionDetail,
  leaf: string,
  nowMs: number,
): MihomoQuicStallTrackedConnection {
  const upload = connection.upload ?? 0
  const download = connection.download ?? 0
  return {
    upload,
    download,
    lastBytesChangeAtMs: nowMs,
    firstSeenAtMs: nowMs,
    host: resolveConnectionHost(connection),
    leaf,
    network: String(connection.metadata?.network ?? ''),
  }
}

function parseConnectionStartMs(start: string | undefined, nowMs: number): number {
  if (!start) {
    return nowMs
  }
  const parsed = Date.parse(start)
  return Number.isFinite(parsed) ? parsed : nowMs
}

export function isMarathonQuIcConnectionFrozen(
  connection: ControllerConnectionDetail,
  tracked: MihomoQuicStallTrackedConnection,
  nowMs: number,
): boolean {
  const startMs = parseConnectionStartMs(connection.start, tracked.firstSeenAtMs)
  const connAgeMs = nowMs - Math.min(tracked.firstSeenAtMs, startMs)
  if (connAgeMs < MIHOMO_QUIC_STALL_MIN_CONN_AGE_MS) {
    return false
  }
  const stallMs = nowMs - tracked.lastBytesChangeAtMs
  if (stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return false
  }
  const uploadSpeed = connection.uploadSpeed ?? 0
  const downloadSpeed = connection.downloadSpeed ?? 0
  return uploadSpeed <= 0 && downloadSpeed <= 0
}

export function countCursorConnectionsFromMihomo(
  connections: readonly ControllerConnectionDetail[],
): number {
  let count = 0
  for (const connection of connections) {
    const metadata = connection.metadata ?? ({} as ControllerConnectionDetail['metadata'])
    const processPath = String(metadata.processPath ?? '')
    const process = String(metadata.process ?? '')
    if (processPath.includes('/Cursor.app/') || process === 'Cursor' || process.startsWith('Cursor ')) {
      count += 1
    }
  }
  return count
}

export function scanMihomoQuicSilentStalls(input: {
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  nowMs: number
  cursorConnectionCount: number
}): MihomoQuicSilentStallObservation[] {
  if (input.cursorConnectionCount < MIHOMO_QUIC_STALL_MARATHON_CONN_THRESHOLD) {
    return []
  }

  const observations: MihomoQuicSilentStallObservation[] = []
  let frozenQuicCursorCount = 0
  let totalQuicCursorCount = 0
  let dominantLeaf = 'unknown'
  let maxFrozenStallMs = 0

  for (const connection of input.connections) {
    if (!isMarathonQuIcCursorTransportConnection(connection)) {
      continue
    }
    const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? []) ?? 'unknown'
    totalQuicCursorCount += 1
    const tracked = input.trackedById.get(connection.id)
    if (!tracked) {
      continue
    }
    if (!isMarathonQuIcConnectionFrozen(connection, tracked, input.nowMs)) {
      continue
    }
    frozenQuicCursorCount += 1
    const stallMs = input.nowMs - tracked.lastBytesChangeAtMs
    if (stallMs > maxFrozenStallMs) {
      maxFrozenStallMs = stallMs
      dominantLeaf = leaf
    }
    const startMs = parseConnectionStartMs(connection.start, tracked.firstSeenAtMs)
    const connAgeMs = input.nowMs - Math.min(tracked.firstSeenAtMs, startMs)
    observations.push({
      kind: 'single',
      connectionId: connection.id,
      host: tracked.host || resolveConnectionHost(connection),
      leaf,
      network: tracked.network,
      stallMs,
      connAgeMs,
      upload: tracked.upload,
      download: tracked.download,
      frozenQuicCursorCount: 0,
      totalQuicCursorCount: 0,
      cursorConnectionCount: input.cursorConnectionCount,
    })
  }

  if (
    input.cursorConnectionCount >= MIHOMO_QUIC_STALL_AGGREGATE_CONN_THRESHOLD &&
    frozenQuicCursorCount >= MIHOMO_QUIC_STALL_AGGREGATE_FROZEN_MIN
  ) {
    observations.push({
      kind: 'aggregate',
      leaf: dominantLeaf,
      stallMs: maxFrozenStallMs,
      frozenQuicCursorCount,
      totalQuicCursorCount,
      cursorConnectionCount: input.cursorConnectionCount,
    })
  }

  for (const observation of observations) {
    if (observation.kind === 'single') {
      observation.frozenQuicCursorCount = frozenQuicCursorCount
      observation.totalQuicCursorCount = totalQuicCursorCount
    }
  }

  return observations
}

export function mihomoQuicSilentStallDedupeKey(observation: MihomoQuicSilentStallObservation): string {
  if (observation.kind === 'aggregate') {
    return `aggregate:${observation.leaf}`
  }
  return `single:${observation.leaf}:${observation.host ?? 'unknown'}:${observation.connectionId ?? 'unknown'}`
}

export function shouldSkipMihomoQuicSilentStallEmit(
  lastEmitAtMs: number | undefined,
  nowMs: number,
  observation: MihomoQuicSilentStallObservation,
): boolean {
  const cooldownMs =
    observation.kind === 'aggregate'
      ? MIHOMO_QUIC_STALL_AGGREGATE_EMIT_COOLDOWN_MS
      : MIHOMO_QUIC_STALL_EMIT_COOLDOWN_MS
  if (lastEmitAtMs == null || lastEmitAtMs <= 0) {
    return false
  }
  return nowMs - lastEmitAtMs < cooldownMs
}

export function formatMihomoQuicSilentStallLogLine(
  observation: MihomoQuicSilentStallObservation,
): string {
  const parts = [
    '[MihomoQuicSilentStall]:',
    'outcome=observed',
    'observe_only=true',
    `kind=${observation.kind}`,
    `leaf=${observation.leaf}`,
    `stall_ms=${observation.stallMs}`,
    `frozen_quic_cursor=${observation.frozenQuicCursorCount}`,
    `total_quic_cursor=${observation.totalQuicCursorCount}`,
    `cursor_conn=${observation.cursorConnectionCount}`,
  ]
  if (observation.connectionId) {
    parts.push(`connection_id=${observation.connectionId}`)
  }
  if (observation.host) {
    parts.push(`host=${observation.host}`)
  }
  if (observation.network) {
    parts.push(`network=${observation.network}`)
  }
  if (observation.connAgeMs != null) {
    parts.push(`conn_age_ms=${observation.connAgeMs}`)
  }
  if (observation.upload != null) {
    parts.push(`upload=${observation.upload}`)
  }
  if (observation.download != null) {
    parts.push(`download=${observation.download}`)
  }
  return `${parts.join(' ')}\n`
}
