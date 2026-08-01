// [INPUT] hy2ParentSidecarCore · transportLongevityTruthCore
// [OUTPUT] runHy2ParentSidecarIfDue
// [POS] P10-2 passive-only — detect/log sidecar/rotate signals; zero data-plane dial/close mutation.

import {
  formatHy2ParentSidecarLogLine,
  HY2_PARENT_PROACTIVE_ROTATE_AGE_MS,
  HY2_PARENT_SIDECAR_COOLDOWN_MS,
  resolveHy2ParentSidecarDialPlan,
  type Hy2ParentSidecarPlan,
} from './hy2ParentSidecarCore'
import {
  countHealthyInnerCriticalFlows,
  findOldestHy2UdpOutboundConnectionId,
} from './hy2ParentRotationCore'
import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

const SIDECAR_DETECT_LOG_COOLDOWN_MS = 600_000

let lastHy2ParentSidecarDetectLogAtMs = 0
let sidecarObserveInFlight = false

export function resetHy2ParentSidecarStateForTests(): void {
  lastHy2ParentSidecarDetectLogAtMs = 0
  sidecarObserveInFlight = false
}

export function getLastHy2ParentSidecarDetectLogAtMsForTests(): number {
  return lastHy2ParentSidecarDetectLogAtMs
}

async function appendSidecarLog(line: string): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

function resolveProactiveUdpCloseDetectPlan(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
  lastRotateDetectLogAtMs: number
}): Hy2ParentSidecarPlan {
  if (
    input.snapshot.outboundHy2SessionAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS &&
    input.snapshot.httpParentChainAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS
  ) {
    return { action: 'none', reason: 'session_and_http_chain_below_proactive_rotate' }
  }
  if (input.nowMs - input.lastRotateDetectLogAtMs < HY2_PARENT_SIDECAR_COOLDOWN_MS) {
    return { action: 'none', reason: 'proactive_rotate_cooldown' }
  }
  const healthyInner = countHealthyInnerCriticalFlows({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
    nowMs: input.nowMs,
    byteActiveWithinMs: 30_000,
    trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
  })
  if (healthyInner > 0) {
    return { action: 'none', reason: 'healthy_inner_critical_flows', healthyInnerCount: healthyInner }
  }
  const udpConnectionId = findOldestHy2UdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
  })
  if (!udpConnectionId) {
    return { action: 'none', reason: 'no_udp_outbound' }
  }
  return {
    action: 'close_udp_outbound',
    reason: 'would_proactive_parent_udp_refresh',
    udpConnectionId,
    healthyInnerCount: 0,
  }
}

export async function runHy2ParentSidecarIfDue(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  marathonTruth: MarathonSSETruthResult
  cursorConnectionCount: number
  nowMs?: number
}): Promise<void> {
  const nowMs = input.nowMs ?? Date.now()
  if (sidecarObserveInFlight) {
    return
  }
  sidecarObserveInFlight = true
  try {
    const dialPlan = resolveHy2ParentSidecarDialPlan({
      snapshot: input.snapshot,
      marathonTruthActive: input.marathonTruth.marathonTruthActive,
      lastSidecarDialAtMs: lastHy2ParentSidecarDetectLogAtMs,
      nowMs,
    })
    const rotatePlan = resolveProactiveUdpCloseDetectPlan({
      snapshot: input.snapshot,
      connections: input.connections,
      trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
      trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
      nowMs,
      lastRotateDetectLogAtMs: lastHy2ParentSidecarDetectLogAtMs,
    })

    const wouldMutate =
      dialPlan.action === 'sidecar_dial' || rotatePlan.action === 'close_udp_outbound'
    if (!wouldMutate) {
      return
    }
    if (nowMs - lastHy2ParentSidecarDetectLogAtMs < SIDECAR_DETECT_LOG_COOLDOWN_MS) {
      return
    }
    lastHy2ParentSidecarDetectLogAtMs = nowMs

    if (dialPlan.action === 'sidecar_dial') {
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: 'skipped',
          action: 'sidecar_dial',
          reason: `${dialPlan.reason} phase=detect_only`,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
        }),
      )
    }
    if (rotatePlan.action === 'close_udp_outbound') {
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: 'skipped',
          action: 'close_udp_outbound',
          reason: `${rotatePlan.reason} phase=detect_only`,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          healthyInnerCount: rotatePlan.healthyInnerCount,
          udpConnectionId: rotatePlan.udpConnectionId,
        }),
      )
    }
  } finally {
    sidecarObserveInFlight = false
  }
}
