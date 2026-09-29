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
  type MihomoQuicSilentStallObservation,
} from './mihomoQuicSilentStallCore'

const SCAN_INTERVAL_MS = 5_000
const HTTP_CURSOR_CONN_RECONCILE_EVERY_N_SCANS = 6

const trackedById = new Map<string, MihomoQuicStallTrackedConnection>()
const lastEmitAtByKey = new Map<string, number>()
let lastScanAtMs = 0
let stallObserverScanGeneration = 0
let lastHttpReconciledCursorConnectionCount = 0
let lastObservedFrozenQuicCursorCount = 0
let lastObservedMaxStallMs = 0
let lastMaxStallSingleObservation: MihomoQuicSilentStallObservation | undefined

export function resetMihomoQuicSilentStallObserverForTests(): void {
  trackedById.clear()
  lastEmitAtByKey.clear()
  lastScanAtMs = 0
  lastObservedFrozenQuicCursorCount = 0
  lastObservedMaxStallMs = 0
  lastMaxStallSingleObservation = undefined
  stallObserverScanGeneration = 0
  lastHttpReconciledCursorConnectionCount = 0
}

/** Latest frozen QUIC Cursor transport count from the most recent stall scan (R-24 MTDO breach). */
export function getMarathonFrozenQuicCursorCount(): number {
  return lastObservedFrozenQuicCursorCount
}

/** Max stall_ms observed on the most recent stall scan (P22b early handoff SSOT). */
export function getMarathonMaxQuicStallMs(): number {
  return lastObservedMaxStallMs
}

/** Single-connection observation with highest stall_ms from the most recent scan (R-18 escalation). */
export function getLastMaxStallSingleObservation(): MihomoQuicSilentStallObservation | undefined {
  return lastMaxStallSingleObservation
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
  stallObserverScanGeneration += 1
  let cursorConnectionCount = countCursorConnectionsFromMihomo(connections)
  if (stallObserverScanGeneration % HTTP_CURSOR_CONN_RECONCILE_EVERY_N_SCANS === 0) {
    try {
      const { countCursorConnections } = await import('./cursorConnectionHygiene')
      lastHttpReconciledCursorConnectionCount = await countCursorConnections()
    } catch {
      // WS count remains authoritative for this tick
    }
  }
  if (lastHttpReconciledCursorConnectionCount > cursorConnectionCount) {
    cursorConnectionCount = lastHttpReconciledCursorConnectionCount
  }
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
  lastMaxStallSingleObservation = observations.reduce<MihomoQuicSilentStallObservation | undefined>(
    (best, observation) => {
      if (observation.kind !== 'single') {
        return best
      }
      if (!best || observation.stallMs > best.stallMs) {
        return observation
      }
      return best
    },
    undefined,
  )

  const activeHy2Leaf =
    resolveMarathonQuIcLeafFromChains(
      connections.find((c) => isMarathonQuIcCursorTransportConnection(c))?.chains ?? [],
    ) ?? 'KR-VPS-HY2'

  try {
    const { resolveMarathonSSETruthSnapshot } = await import('./marathonSSETruthRuntime')
    const { truth: marathonTruth, registry } = await resolveMarathonSSETruthSnapshot(cursorConnectionCount)
    const { readTransportLongevityTruthSnapshot, writeTransportLongevityTruthSnapshot } =
      await import('./transportLongevityTruth')
    const previousLongevitySnapshot = await readTransportLongevityTruthSnapshot()
    const longevitySnapshot = buildTransportLongevityTruth({
      nowMs,
      cursorConnectionCount,
      marathonTruth,
      connections,
      trackedById,
      activeHy2Leaf,
      maxByteStallMs: lastObservedMaxStallMs,
      frozenQuicCursorCount: lastObservedFrozenQuicCursorCount,
      previousSnapshot: previousLongevitySnapshot,
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
    const { bindMarathonCarrierConnections } = await import('./marathonCarrierConnectionBindCore')
    const { setMarathonRecoveryContextForPrune, setMarathonTokenGapSnapshotForRecovery } =
      await import('./mihomoQuicSilentStallRecovery')
    const { readMarathonStreamTokenGapSignal } = await import('./cursorStreamTokenGapReader')
    const tokenGapSignal = await readMarathonStreamTokenGapSignal(cursorConnectionCount, nowMs)
    if (tokenGapSignal) {
      setMarathonTokenGapSnapshotForRecovery({
        maxGapMs: tokenGapSignal.maxGapMs,
        staleRequestIdCount: tokenGapSignal.staleRequestIds.length,
      })
    }
    const boundRegistry = bindMarathonCarrierConnections({
      registry,
      connections,
      trackedById,
      staleRequestIds: tokenGapSignal?.staleRequestIds ?? [],
      nowMs,
    })
    setMarathonRecoveryContextForPrune({
      marathonActive: marathonTruth.marathonTruthActive,
      registryMaxGapSinceActivityMs: computeRegistryMaxGapSinceActivityMs(boundRegistry, nowMs),
      httpParentChainAgeMs: longevitySnapshot.httpParentChainAgeMs,
      outboundHy2SessionAgeMs: longevitySnapshot.outboundHy2SessionAgeMs,
      staleRequestIds: tokenGapSignal?.staleRequestIds ?? [],
      registry: boundRegistry,
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
        recoveryIneffective: longevitySnapshot.maxByteStallMs >= 15_000,
      })
    } catch {
      // sidecar is best-effort; longevity truth remains authoritative
    }
    const postSidecarSnapshot =
      (await readTransportLongevityTruthSnapshot()) ?? longevitySnapshot
    if (cursorConnectionCount >= 12) {
      const { resolveParentLifecyclePhase, formatParentLifecycleLogLine } =
        await import('./parentLifecycleCore')
      const phase = resolveParentLifecyclePhase({
        snapshot: postSidecarSnapshot,
        recoveryIneffective: postSidecarSnapshot.maxByteStallMs >= 15_000,
        refreshExhausted: false,
        marathonActive: marathonTruth.marathonTruthActive,
      })
      if (phase !== 'young') {
        await appendAppLog(
          formatParentLifecycleLogLine({
            phase,
            httpParentChainAgeMs: postSidecarSnapshot.httpParentChainAgeMs,
            outboundHy2SessionAgeMs: postSidecarSnapshot.outboundHy2SessionAgeMs,
            maxByteStallMs: postSidecarSnapshot.maxByteStallMs,
          }),
        )
      }
    }
    const finalLongevitySnapshot = {
      ...postSidecarSnapshot,
      // 实时解析的叶名覆盖旧快照——禁止幽灵叶名（如已下线的 JP-VPS-HY2）流入证据
      activeHy2Leaf,
      maxByteStallMs:
        postSidecarSnapshot.maxByteStallMs === 0 &&
        postSidecarSnapshot.httpParentChainAgeMs === 0
          ? 0
          : lastObservedMaxStallMs,
    }
    await writeTransportLongevityTruthSnapshot(finalLongevitySnapshot)
    if (cursorConnectionCount >= 12) {
      await appendAppLog(formatTransportLongevityTruthLogLine(finalLongevitySnapshot))
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
