// [INPUT] hy2ParentSidecarCore · hy2ParentRotationCore · hy2TunnelVitality · mihomoApi
// [OUTPUT] runHy2ParentSidecarIfDue
// [POS] R-35a runtime — proactive 4h sidecar dial + safe UDP rotate when no healthy inner flows.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import {
  countHealthyInnerCriticalFlows,
  findOldestHy2UdpOutboundConnectionId,
} from './hy2ParentRotationCore'
import {
  formatHy2ParentSidecarLogLine,
  HY2_PARENT_PROACTIVE_ROTATE_AGE_MS,
  HY2_PARENT_SIDECAR_COOLDOWN_MS,
  resolveHy2ParentSidecarDialPlan,
  type Hy2ParentSidecarPlan,
} from './hy2ParentSidecarCore'
import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'
import { mihomoCloseConnection } from './mihomoApi'

let lastHy2ParentSidecarDialAtMs = 0
let lastHy2ParentSidecarRotateAtMs = 0
let sidecarInFlight = false

export function resetHy2ParentSidecarStateForTests(): void {
  lastHy2ParentSidecarDialAtMs = 0
  lastHy2ParentSidecarRotateAtMs = 0
  sidecarInFlight = false
}

export function getLastHy2ParentSidecarDialAtMsForTests(): number {
  return lastHy2ParentSidecarDialAtMs
}

async function appendSidecarLog(line: string): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

function resolveProactiveUdpClosePlan(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
}): Hy2ParentSidecarPlan {
  if (
    input.snapshot.outboundHy2SessionAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS &&
    input.snapshot.httpParentChainAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS
  ) {
    return { action: 'none', reason: 'session_and_http_chain_below_proactive_rotate' }
  }
  if (input.nowMs - lastHy2ParentSidecarRotateAtMs < HY2_PARENT_SIDECAR_COOLDOWN_MS) {
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
    reason: 'proactive_parent_udp_refresh',
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
  if (sidecarInFlight) {
    return
  }
  sidecarInFlight = true
  try {
    const dialPlan = resolveHy2ParentSidecarDialPlan({
      snapshot: input.snapshot,
      marathonTruthActive: input.marathonTruth.marathonTruthActive,
      lastSidecarDialAtMs: lastHy2ParentSidecarDialAtMs,
      nowMs,
    })
    if (dialPlan.action === 'sidecar_dial') {
      try {
        const { executeMarathonRescueDial } = await import('./marathonRescueDialExecutor')
        const result = await executeMarathonRescueDial(input.cursorConnectionCount, {
          trigger: 'hy2_parent_sidecar',
          nowMs,
        })
        lastHy2ParentSidecarDialAtMs = nowMs
        await appendSidecarLog(
          formatHy2ParentSidecarLogLine({
            outcome: result.outcome === 'executed' ? 'executed' : 'failed',
            action: 'sidecar_dial',
            reason: dialPlan.reason,
            outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
            httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
            connectPathDelayMs: result.api2DelayMs,
            err: result.err,
          }),
        )
      } catch (error) {
        await appendSidecarLog(
          formatHy2ParentSidecarLogLine({
            outcome: 'failed',
            action: 'sidecar_dial',
            reason: dialPlan.reason,
            outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
            httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
            err: formatUnknownErrorForLog(error),
          }),
        )
      }
    }

    const rotatePlan = resolveProactiveUdpClosePlan({
      snapshot: input.snapshot,
      connections: input.connections,
      trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
      trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
      nowMs,
    })
    if (rotatePlan.action !== 'close_udp_outbound' || !rotatePlan.udpConnectionId) {
      return
    }
    try {
      await mihomoCloseConnection(rotatePlan.udpConnectionId)
      lastHy2ParentSidecarRotateAtMs = nowMs
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: 'executed',
          action: 'close_udp_outbound',
          reason: rotatePlan.reason,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          healthyInnerCount: rotatePlan.healthyInnerCount,
          udpConnectionId: rotatePlan.udpConnectionId,
        }),
      )
    } catch (error) {
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: 'failed',
          action: 'close_udp_outbound',
          reason: rotatePlan.reason,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          healthyInnerCount: rotatePlan.healthyInnerCount,
          udpConnectionId: rotatePlan.udpConnectionId,
          err: formatUnknownErrorForLog(error),
        }),
      )
    }
  } finally {
    sidecarInFlight = false
  }
}
