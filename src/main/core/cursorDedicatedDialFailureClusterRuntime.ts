// [INPUT] cursorDedicatedDialFailureClusterCore · hy2ParentSidecar · failback
// [OUTPUT] ingestCoreLogLineForDialFailureCluster · cluster recovery dispatch
// [POS] BUG-2026-09-03-005 runtime — bypass sidecar cooldown on Cursor dial failure bursts.

import { appendAppLog } from '../utils/log'
import {
  classifyCursorDedicatedDialFailureLine,
  CURSOR_DIAL_FAILURE_CLUSTER_RECOVERY_COOLDOWN_MS,
  isCursorDedicatedDialFailureCluster,
  pruneCursorDedicatedDialFailureEvents,
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

    const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
    const marathonTruth = await resolveMarathonSSETruthNow(snapshot.cursorConnectionCount)
    const { mihomoGetConnections } = await import('./mihomoApi')
    const connectionPayload = await mihomoGetConnections()
    const connections = connectionPayload.connections ?? []

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
    })

    await appendAppLog(
      `[CursorDialFailureCluster]: outcome=${sidecar.outcome} sidecar_action=${sidecar.action} reason=${sidecar.reason}\n`,
    )

    if (sidecar.outcome === 'executed') {
      try {
        const { notifyCollectiveDeathAlert } = await import('./collectiveDeathAlert')
        await notifyCollectiveDeathAlert({
          trigger: 'byte_death_exhausted',
          title: '网络集体恢复中',
          body: `检测到 Cursor 专用路径 ${clusterSize} 次 dial 失败，已触发 sidecar 恢复。`,
          cursorConnectionCount: snapshot.cursorConnectionCount,
          leafId: activeLeaf,
          evidenceReason: 'cursor_dedicated_dial_failure_cluster',
          tsMs: nowMs,
        })
      } catch {
        // best-effort toast
      }
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
