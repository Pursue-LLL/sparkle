// [INPUT] cursorDedicatedDialFailureClusterCore · hy2ParentSidecar · failback
// [OUTPUT] ingestCoreLogLineForDialFailureCluster · cluster recovery dispatch
// [POS] BUG-2026-09-03-005/008 — tail-detected dial clusters → force HY2 UDP parent refresh.

import { appendAppLog } from '../utils/log'
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

    const { forceClearRecoveryCircuitForClusterRecovery } = await import(
      './recoveryCircuitBreaker'
    )
    await forceClearRecoveryCircuitForClusterRecovery(nowMs, clusterSize)

    const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
    const activeLeaf = (await resolveCursorDedicatedActiveNode()) ?? 'JP-VPS-HY2'
    const { attemptCursorDedicatedHy2FailbackIfDue } = await import(
      './recoveryCursorDedicatedFailback'
    )
    await attemptCursorDedicatedHy2FailbackIfDue(activeLeaf, nowMs)

    const { readTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
    const snapshot = await readTransportLongevityTruthSnapshot()
    if (!snapshot) {
      await appendAppLog(
        `[CursorDialFailureCluster]: outcome=skipped reason=missing_longevity_snapshot\n`,
      )
      return
    }

    const { mihomoGetConnections } = await import('./mihomoApi')
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
        const { notifyRecoveryCircuitSuccess } = await import('./recoveryCircuitBreaker')
        await notifyRecoveryCircuitSuccess()
        await appendAppLog(
          `[CursorDialFailureCluster]: outcome=executed action=${sidecar.action} reason=${sidecar.reason} ` +
            `fallback=sidecar_after_no_udp cluster_size=${clusterSize}\n`,
        )
        return
      }

      const { requestEmergencyCoreRecovery } = await import('./emergencyCoreRecovery')
      const { DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART } = await import(
        './cursorDedicatedDialFailureClusterCore'
      )
      const emergency = await requestEmergencyCoreRecovery({
        reason: 'confirmed_udp_parent_absent',
        leafId: snapshot.activeHy2Leaf?.trim() ?? activeLeaf,
        evidenceReason: DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART,
        cursorConnectionCount: snapshot.cursorConnectionCount,
        nowMs,
      })
      await appendAppLog(
        `[CursorDialFailureCluster]: outcome=${emergency.executed ? 'executed' : 'failed'} ` +
          `action=emergency_core_recovery reason=${emergency.reason} cluster_size=${clusterSize}\n`,
      )
      if (emergency.executed) {
        try {
          const { notifyCollectiveDeathAlert } = await import('./collectiveDeathAlert')
          await notifyCollectiveDeathAlert({
            trigger: 'byte_death_exhausted',
            title: '网络集体恢复中',
            body: `Cursor 专用路径 ${clusterSize} 次 dial 失败，已触发 emergency core 重建。`,
            cursorConnectionCount: snapshot.cursorConnectionCount,
            leafId: activeLeaf,
            evidenceReason: DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART,
            tsMs: nowMs,
          })
        } catch {
          // best-effort toast
        }
      }
      return
    }

    const { mihomoCloseConnection } = await import('./mihomoApi')
    await mihomoCloseConnection(udpResolution.connectionId)
    const { resetTransportLongevityHy2ParentChainBirth } = await import(
      './transportLongevityTruth'
    )
    await resetTransportLongevityHy2ParentChainBirth(
      snapshot.activeHy2Leaf?.trim() ?? activeLeaf,
      nowMs,
    )

    const { notifyRecoveryCircuitSuccess } = await import('./recoveryCircuitBreaker')
    await notifyRecoveryCircuitSuccess()

    await appendAppLog(
      `[CursorDialFailureCluster]: outcome=executed action=close_udp_parent ` +
        `udp_connection_id=${udpResolution.connectionId} source=${udpResolution.source} ` +
        `cluster_size=${clusterSize} reason=${forcePlan.reason}\n`,
    )
    try {
      const { notifyCollectiveDeathAlert } = await import('./collectiveDeathAlert')
      await notifyCollectiveDeathAlert({
        trigger: 'byte_death_exhausted',
        title: '网络集体恢复中',
        body: `Cursor 专用路径 ${clusterSize} 次 dial 失败，已强制重建 HY2 会话。`,
        cursorConnectionCount: snapshot.cursorConnectionCount,
        leafId: activeLeaf,
        evidenceReason: 'cursor_dedicated_dial_failure_cluster',
        tsMs: nowMs,
      })
    } catch {
      // best-effort toast
    }
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
