// [INPUT] cursorDedicatedDialFailureClusterCore · hy2ParentSidecar · failback
// [OUTPUT] ingestCoreLogLineForDialFailureCluster · cluster recovery dispatch
// [POS] BUG-2026-09-03-005/008 — tail-detected dial clusters → force HY2 UDP parent refresh.

import { appendAppLog } from '../utils/log'
import { mihomoGetConnections } from './mihomoApi'
import {
  classifyCursorDedicatedDialFailureLine,
  CURSOR_DIAL_FAILURE_CLUSTER_RECOVERY_COOLDOWN_MS,
  isCursorDedicatedDialFailureCluster,
  pruneCursorDedicatedDialFailureEvents,
  shouldForceParentUdpRefreshOnDialCluster,
  type CursorDedicatedDialFailureEvent,
} from './cursorDedicatedDialFailureClusterCore'

let recentEvents: CursorDedicatedDialFailureEvent[] = []
let recoveryInFlight = false
let lastClusterRecoveryAtMs = 0

export function resetCursorDedicatedDialFailureClusterForTests(): void {
  recentEvents = []
  recoveryInFlight = false
  lastClusterRecoveryAtMs = 0
}

export function getCursorDedicatedDialFailureEventsForTests(): readonly CursorDedicatedDialFailureEvent[] {
  return recentEvents
}

async function dispatchDialFailureClusterRecovery(
  nowMs: number,
  clusterSize: number,
): Promise<void> {
  if (recoveryInFlight) {
    return
  }
  if (nowMs - lastClusterRecoveryAtMs < CURSOR_DIAL_FAILURE_CLUSTER_RECOVERY_COOLDOWN_MS) {
    return
  }
  recoveryInFlight = true
  lastClusterRecoveryAtMs = nowMs
  try {
    await appendAppLog(
      `[CursorDialFailureCluster]: outcome=detected cluster_size=${clusterSize} action=dispatch_recovery\n`,
    )

    const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
    const activeLeaf = (await resolveCursorDedicatedActiveNode()) ?? 'KR-VPS-HY2'

    const { readTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
    const snapshot = await readTransportLongevityTruthSnapshot()
    if (!snapshot) {
      await appendAppLog(
        `[CursorDialFailureCluster]: outcome=skipped reason=missing_longevity_snapshot\n`,
      )
      return
    }

    const connectionPayload = await mihomoGetConnections()
    const connections = connectionPayload.connections ?? []

    const forcePlan = shouldForceParentUdpRefreshOnDialCluster({
      clusterSize,
      activeLeaf,
    })
    if (!forcePlan.force) {
      await appendAppLog(
        `[CursorDialFailureCluster]: outcome=skipped reason=${forcePlan.reason}\n`,
      )
      return
    }

    const { resolveHy2ParentUdpOutboundConnectionId } = await import(
      './hy2ParentCarrierIdentityCore'
    )
    const udpResolution = resolveHy2ParentUdpOutboundConnectionId({
      connections,
      activeLeaf: snapshot.activeHy2Leaf?.trim() ?? activeLeaf,
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
      byteDeathFullScan: true,
    })
    if (!udpResolution.connectionId) {
      await appendAppLog(
        `[CursorDialFailureCluster]: outcome=planned action=fallback_ladder reason=no_udp_parent_found ` +
          `total_connections=${udpResolution.diagnostics?.totalConnections ?? connections.length}\n`,
      )

      const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
      const marathonTruth = await resolveMarathonSSETruthNow(snapshot.cursorConnectionCount)
      const { runHy2ParentSidecarIfDue } = await import('./hy2ParentSidecar')
      const sidecar = await runHy2ParentSidecarIfDue({
        snapshot,
        connections,
        trackedFirstSeenAtMsById: new Map(),
        trackedLastByteChangeAtMsById: new Map(),
        marathonTruth,
        cursorConnectionCount: snapshot.cursorConnectionCount,
        nowMs,
        dialFailureClusterEscalation: true,
        emergencyStallEscalation: true,
        recoveryIneffective: true,
      })
      if (sidecar.outcome === 'executed') {
        await appendAppLog(
          `[CursorDialFailureCluster]: outcome=executed action=${sidecar.action} reason=${sidecar.reason} ` +
            `fallback=sidecar_after_no_udp cluster_size=${clusterSize}\n`,
        )
        return
      }

      await appendAppLog(
        `[CursorDialFailureCluster]: pure_pipe_protection — skipped emergency_core_recovery cluster_size=${clusterSize}\n`,
      )
      return
    }

    // Pure-Pipe: do not close UDP parent connection
    await appendAppLog(
      `[CursorDialFailureCluster]: pure_pipe_protection — skipped close_udp_parent cluster_size=${clusterSize}\n`,
    )
    return
  } finally {
    recoveryInFlight = false
  }
}

export function ingestCoreLogLineForDialFailureCluster(line: string, nowMs?: number): void {
  const event = classifyCursorDedicatedDialFailureLine(line)
  if (!event) {
    return
  }
  const atMs = nowMs ?? Date.now()
  recentEvents = pruneCursorDedicatedDialFailureEvents([...recentEvents, event], atMs)
  if (!isCursorDedicatedDialFailureCluster({ events: recentEvents })) {
    return
  }
  void dispatchDialFailureClusterRecovery(atMs, recentEvents.length)
}
