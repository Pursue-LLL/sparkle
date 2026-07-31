// [INPUT] mihomoQuicSilentStallCore · quicStallSsot · networkStabilityMonitor · appendAppLog
// [OUTPUT] observeMihomoConnectionsForQuicSilentStall · getMarathonMaxQuicStallMs
// [POS] R-16/R-33 runtime — mihomo /connections WS hook; writes quic-stall-ssot.json for patch-315.

import { appendAppLog } from '../utils/log'
import {
  buildTransportLongevityTruth,
  formatTransportLongevityTruthLogLine,
} from './transportLongevityTruthCore'
import {
  createMihomoQuicStallTrackedConnection,
  countCursorConnectionsFromMihomo,
  countMarathonFrozenQuicCursorConnections,
  formatMihomoQuicSilentStallLogLine,
  isMarathonQuIcCursorTransportConnection,
  mihomoQuicSilentStallDedupeKey,
  resolveMarathonQuIcLeafFromChains,
  scanMihomoQuicSilentStalls,
  shouldSkipMihomoQuicSilentStallEmit,
  updateMihomoQuicStallTrackedConnection,
  type MihomoQuicStallTrackedConnection,
} from './mihomoQuicSilentStallCore'

const SCAN_INTERVAL_MS = 5_000

const trackedById = new Map<string, MihomoQuicStallTrackedConnection>()
const lastEmitAtByKey = new Map<string, number>()
let lastScanAtMs = 0
let lastObservedFrozenQuicCursorCount = 0
let lastObservedMaxStallMs = 0

export function resetMihomoQuicSilentStallObserverForTests(): void {
  trackedById.clear()
  lastEmitAtByKey.clear()
  lastScanAtMs = 0
  lastObservedFrozenQuicCursorCount = 0
  lastObservedMaxStallMs = 0
}

/** Latest frozen QUIC Cursor transport count from the most recent stall scan (R-24 MTDO breach). */
export function getMarathonFrozenQuicCursorCount(): number {
  return lastObservedFrozenQuicCursorCount
}

/** Max stall_ms observed on the most recent stall scan (P22b early handoff SSOT). */
export function getMarathonMaxQuicStallMs(): number {
  return lastObservedMaxStallMs
}

function syncTrackedConnections(connections: readonly ControllerConnectionDetail[]): void {
  const liveIds = new Set<string>()
  const nowMs = Date.now()
  for (const connection of connections) {
    liveIds.add(connection.id)
    if (!isMarathonQuIcCursorTransportConnection(connection)) {
      continue
    }
    const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? [])
    if (!leaf) {
      continue
    }
    const existing = trackedById.get(connection.id)
    if (existing) {
      trackedById.set(connection.id, updateMihomoQuicStallTrackedConnection(existing, connection, nowMs))
      continue
    }
    trackedById.set(connection.id, createMihomoQuicStallTrackedConnection(connection, leaf, nowMs))
  }
  for (const id of trackedById.keys()) {
    if (!liveIds.has(id)) {
      trackedById.delete(id)
    }
  }
}

export async function observeMihomoConnectionsForQuicSilentStall(
  payload: ControllerConnections,
): Promise<void> {
  const nowMs = Date.now()
  if (nowMs - lastScanAtMs < SCAN_INTERVAL_MS) {
    return
  }
  lastScanAtMs = nowMs

  const connections = payload.connections ?? []
  syncTrackedConnections(connections)
  const cursorConnectionCount = countCursorConnectionsFromMihomo(connections)
  lastObservedFrozenQuicCursorCount = countMarathonFrozenQuicCursorConnections({
    connections,
    trackedById,
    nowMs,
  })
  const observations = scanMihomoQuicSilentStalls({
    connections,
    trackedById,
    nowMs,
    cursorConnectionCount,
  })
  lastObservedMaxStallMs = observations.reduce(
    (max, observation) => Math.max(max, observation.stallMs),
    0,
  )

  const activeHy2Leaf =
    resolveMarathonQuIcLeafFromChains(
      connections.find((c) => isMarathonQuIcCursorTransportConnection(c))?.chains ?? [],
    ) ?? 'JP-VPS-HY2'

  try {
    const { resolveMarathonSSETruthSnapshot } = await import('./marathonSSETruthRuntime')
    const { truth: marathonTruth, registry } = await resolveMarathonSSETruthSnapshot(cursorConnectionCount)
    const longevitySnapshot = buildTransportLongevityTruth({
      nowMs,
      cursorConnectionCount,
      marathonTruth,
      connections,
      trackedById,
      activeHy2Leaf,
      maxByteStallMs: lastObservedMaxStallMs,
      frozenQuicCursorCount: lastObservedFrozenQuicCursorCount,
    })
    const trackedFirstSeenAtMsById = new Map<string, number>()
    const trackedLastByteChangeAtMsById = new Map<string, number>()
    for (const [id, tracked] of trackedById) {
      trackedFirstSeenAtMsById.set(id, tracked.firstSeenAtMs)
      trackedLastByteChangeAtMsById.set(id, tracked.lastBytesChangeAtMs)
    }
    const { setTransportLongevityContextForRecovery } = await import('./mihomoQuicSilentStallRecovery')
    setTransportLongevityContextForRecovery({
      snapshot: longevitySnapshot,
      connections,
      trackedFirstSeenAtMsById,
      trackedLastByteChangeAtMsById,
    })
    const { computeRegistryMaxGapSinceActivityMs } = await import('./marathonSseCarrierPruneCore')
    const { setMarathonRecoveryContextForPrune } = await import('./mihomoQuicSilentStallRecovery')
    setMarathonRecoveryContextForPrune({
      marathonActive: marathonTruth.marathonTruthActive,
      registryMaxGapSinceActivityMs: computeRegistryMaxGapSinceActivityMs(registry, nowMs),
      httpParentChainAgeMs: longevitySnapshot.httpParentChainAgeMs,
      outboundHy2SessionAgeMs: longevitySnapshot.outboundHy2SessionAgeMs,
    })
    try {
      const { runHy2ParentSidecarIfDue } = await import('./hy2ParentSidecar')
      await runHy2ParentSidecarIfDue({
        snapshot: longevitySnapshot,
        connections,
        trackedFirstSeenAtMsById,
        trackedLastByteChangeAtMsById,
        marathonTruth,
        cursorConnectionCount,
        nowMs,
      })
    } catch {
      // sidecar is best-effort; longevity truth remains authoritative
    }
    const { writeTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
    await writeTransportLongevityTruthSnapshot(longevitySnapshot)
    if (cursorConnectionCount >= 12) {
      await appendAppLog(formatTransportLongevityTruthLogLine(longevitySnapshot))
    }
  } catch {
    // quic-stall-ssot remains authoritative if longevity write fails
  }

  try {
    const { writeQuicStallSsotSnapshot } = await import('./quicStallSsot')
    await writeQuicStallSsotSnapshot({
      maxStallMs: lastObservedMaxStallMs,
      frozenQuicCursorCount: lastObservedFrozenQuicCursorCount,
      cursorConnectionCount,
      nowMs,
    })
  } catch {
    // app-log + jsonl remain authoritative if atom write fails
  }

  for (const observation of observations) {
    const dedupeKey = mihomoQuicSilentStallDedupeKey(observation)
    const lastEmitAtMs = lastEmitAtByKey.get(dedupeKey)
    if (shouldSkipMihomoQuicSilentStallEmit(lastEmitAtMs, nowMs, observation)) {
      continue
    }
    lastEmitAtByKey.set(dedupeKey, nowMs)
    await appendAppLog(formatMihomoQuicSilentStallLogLine(observation))
    try {
      const { executeMihomoQuicStallRecoveryIfDue } = await import('./mihomoQuicSilentStallRecovery')
      await executeMihomoQuicStallRecoveryIfDue(observation, nowMs)
    } catch {
      // detection log remains authoritative if recovery import fails
    }
    try {
      const { appendNetworkStabilityEvent } = await import('./networkStabilityMonitor')
      await appendNetworkStabilityEvent({
        ts: new Date(nowMs).toISOString(),
        kind: 'mihomo_quic_silent_stall',
        proxy_node: observation.leaf,
        error_detail: [
          `kind=${observation.kind}`,
          `stall_ms=${observation.stallMs}`,
          `frozen_quic_cursor=${observation.frozenQuicCursorCount}`,
          `total_quic_cursor=${observation.totalQuicCursorCount}`,
          `cursor_conn=${observation.cursorConnectionCount}`,
          observation.host ? `host=${observation.host}` : '',
          observation.connectionId ? `connection_id=${observation.connectionId}` : '',
          observation.network ? `network=${observation.network}` : '',
        ]
          .filter(Boolean)
          .join(';'),
      })
    } catch {
      // observe-only — app-log line is authoritative
    }
  }
}
