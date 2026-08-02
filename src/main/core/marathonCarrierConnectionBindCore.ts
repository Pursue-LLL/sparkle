// [INPUT] MarathonStreamRegistry · mihomo connections · stall tracked bytes
// [OUTPUT] bindMarathonCarrierConnections · resolveStallRecoveryCloseTarget
// [POS] R-38 SSOT — RID → carrier mihomo connectionId; close dying SSE carrier not short probe.

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import {
  isMarathonQuIcConnectionFrozen,
  isMarathonQuIcCursorTransportConnection,
  resolveConnectionHost,
  type MihomoQuicStallTrackedConnection,
} from './mihomoQuicSilentStallCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import type { MarathonStreamRecord, MarathonStreamRegistry } from './marathonStreamRegistryCore'

/** Short api2 vitality probes stay below this total byte count (9480ace0-class). */
export const MARATHON_CARRIER_MIN_TOTAL_BYTES = 15_000

/** Young low-byte flows are dial probes, not marathon SSE carriers. */
export const MARATHON_CARRIER_PROBE_MAX_CONN_AGE_MS = 300_000

export type StallRecoveryCloseTargetSource =
  | 'registry_carrier_bound'
  | 'carrier_rid_mapped'
  | 'observation_aligned'
  | 'observation_fallback'

export interface StallRecoveryCloseTarget {
  connectionId: string
  host?: string
  closeTargetSource: StallRecoveryCloseTargetSource
}

function totalBytes(connection: ControllerConnectionDetail): number {
  return (connection.upload ?? 0) + (connection.download ?? 0)
}

function connectionConnAgeMs(
  connection: ControllerConnectionDetail,
  tracked: MihomoQuicStallTrackedConnection,
  nowMs: number,
): number {
  return Math.max(0, nowMs - tracked.firstSeenAtMs)
}

export function isLikelyShortVitalityProbe(input: {
  connection: ControllerConnectionDetail
  tracked: MihomoQuicStallTrackedConnection
  nowMs: number
}): boolean {
  const bytes = totalBytes(input.connection)
  const connAgeMs = connectionConnAgeMs(input.connection, input.tracked, input.nowMs)
  return bytes < MARATHON_CARRIER_MIN_TOTAL_BYTES && connAgeMs < MARATHON_CARRIER_PROBE_MAX_CONN_AGE_MS
}

function scoreFrozenCarrierCandidate(input: {
  connection: ControllerConnectionDetail
  tracked: MihomoQuicStallTrackedConnection
  nowMs: number
}): number {
  const host = resolveConnectionHost(input.connection)
  if (!host || !isCriticalCursorHost(host)) {
    return -1
  }
  if (!isMarathonQuIcCursorTransportConnection(input.connection)) {
    return -1
  }
  if (!isMarathonQuIcConnectionFrozen(input.connection, input.tracked, input.nowMs)) {
    return -1
  }
  if (isLikelyShortVitalityProbe(input)) {
    return -1
  }
  const stallMs = input.nowMs - input.tracked.lastBytesChangeAtMs
  return totalBytes(input.connection) + stallMs
}

export function pickCarrierConnectionForRid(input: {
  carrierRid: string
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  nowMs: number
}): { connectionId: string; host: string } | undefined {
  const carrierRid = input.carrierRid.trim()
  if (!carrierRid) {
    return undefined
  }

  let best: { connectionId: string; host: string; score: number } | undefined
  for (const connection of input.connections) {
    const tracked = input.trackedById.get(connection.id)
    if (!tracked) {
      continue
    }
    const score = scoreFrozenCarrierCandidate({
      connection,
      tracked,
      nowMs: input.nowMs,
    })
    if (score < 0) {
      continue
    }
    const host = resolveConnectionHost(connection)
    if (!best || score > best.score) {
      best = { connectionId: connection.id, host, score }
    }
  }
  if (!best) {
    return undefined
  }
  return { connectionId: best.connectionId, host: best.host }
}

function findRegistryCarrierBinding(
  registry: MarathonStreamRegistry,
  carrierRid: string,
  connections: readonly ControllerConnectionDetail[],
): { connectionId: string; host?: string } | undefined {
  const liveIds = new Set(connections.map((connection) => connection.id))
  for (const record of registry.records.values()) {
    if (record.originalRequestId !== carrierRid) {
      continue
    }
    const boundId = record.carrierConnectionId?.trim()
    if (boundId && liveIds.has(boundId)) {
      return { connectionId: boundId, host: record.carrierHost }
    }
  }
  return undefined
}

export function bindMarathonCarrierConnections(input: {
  registry: MarathonStreamRegistry
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  staleRequestIds: readonly string[]
  nowMs: number
}): MarathonStreamRegistry {
  const records = new Map<string, MarathonStreamRecord>()
  for (const [key, record] of input.registry.records) {
    records.set(key, { ...record })
  }

  const ridsToBind = new Set<string>()
  for (const rid of input.staleRequestIds) {
    const trimmed = rid.trim()
    if (trimmed) {
      ridsToBind.add(trimmed)
    }
  }
  for (const record of records.values()) {
    const gapMs = Math.max(0, input.nowMs - record.lastActivityMs)
    if (gapMs >= 20_000) {
      ridsToBind.add(record.originalRequestId)
    }
  }

  for (const carrierRid of ridsToBind) {
    const picked = pickCarrierConnectionForRid({
      carrierRid,
      connections: input.connections,
      trackedById: input.trackedById,
      nowMs: input.nowMs,
    })
    if (!picked) {
      continue
    }
    for (const [key, record] of records) {
      if (record.originalRequestId !== carrierRid) {
        continue
      }
      records.set(key, {
        ...record,
        carrierConnectionId: picked.connectionId,
        carrierHost: picked.host,
        carrierBoundAtMs: input.nowMs,
      })
    }
  }

  return { records }
}

export function resolveStallRecoveryCloseTarget(input: {
  observation: MihomoQuicSilentStallObservation
  carrierRid?: string
  registry: MarathonStreamRegistry
  connections: readonly ControllerConnectionDetail[]
  trackedById: ReadonlyMap<string, MihomoQuicStallTrackedConnection>
  nowMs: number
}): StallRecoveryCloseTarget {
  const observationId = input.observation.connectionId?.trim() ?? ''
  const observationTracked = observationId ? input.trackedById.get(observationId) : undefined
  const observationIsShortProbe =
    observationId &&
    observationTracked &&
    isLikelyShortVitalityProbe({
      connection: input.connections.find((connection) => connection.id === observationId) ?? {
        id: observationId,
        upload: input.observation.upload ?? 0,
        download: input.observation.download ?? 0,
        metadata: { host: input.observation.host, network: input.observation.network },
        chains: ['JP-VPS-HY2'],
      } as ControllerConnectionDetail,
      tracked: observationTracked,
      nowMs: input.nowMs,
    })

  const carrierRid = input.carrierRid?.trim()
  if (carrierRid) {
    const registryBound = findRegistryCarrierBinding(input.registry, carrierRid, input.connections)
    if (registryBound) {
      return {
        connectionId: registryBound.connectionId,
        host: registryBound.host,
        closeTargetSource: 'registry_carrier_bound',
      }
    }

    const mapped = pickCarrierConnectionForRid({
      carrierRid,
      connections: input.connections,
      trackedById: input.trackedById,
      nowMs: input.nowMs,
    })
    if (mapped) {
      return {
        connectionId: mapped.connectionId,
        host: mapped.host,
        closeTargetSource: 'carrier_rid_mapped',
      }
    }
  }

  if (observationId) {
    if (carrierRid && observationIsShortProbe) {
      return {
        connectionId: '',
        closeTargetSource: 'observation_fallback',
      }
    }
    return {
      connectionId: observationId,
      host: input.observation.host,
      closeTargetSource: carrierRid ? 'observation_aligned' : 'observation_fallback',
    }
  }

  return {
    connectionId: '',
    closeTargetSource: 'observation_fallback',
  }
}
