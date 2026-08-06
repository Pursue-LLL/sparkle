// [INPUT] hy2ParentSidecarCore · transportLongevityTruthCore · hy2TunnelVitality · mihomoApi
// [OUTPUT] runHy2ParentSidecarIfDue
// [POS] R-35a execute — proactive HY2 parent sidecar dial + UDP outbound refresh @ 4h.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import {
  formatCarrierQuiesceRefreshLogLine,
  isMarathonGlobalByteDeath,
  resolveCarrierQuiesceRefreshDecision,
} from './carrierQuiesceRefreshCore'
import {
  formatHy2ParentSidecarLogLine,
  HY2_PARENT_PROACTIVE_ROTATE_AGE_MS,
  HY2_PARENT_SIDECAR_COOLDOWN_MS,
  resolveHy2ParentSidecarDialPlan,
  type Hy2ParentSidecarPlan,
} from './hy2ParentSidecarCore'
import { executeByteDeathParentMutation } from './hy2ParentByteDeathRecoveryExecutor'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'
import { countActiveInnerCriticalFlows } from './hy2ParentRotationCore'
import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

const SIDECAR_ACTION_COOLDOWN_MS = 300_000

let lastHy2ParentSidecarActionAtMs = 0
let sidecarObserveInFlight = false

export interface Hy2ParentSidecarExecutionResult {
  outcome: 'executed' | 'skipped' | 'failed'
  action: Hy2ParentSidecarPlan['action']
  reason: string
}

export function resetHy2ParentSidecarStateForTests(): void {
  lastHy2ParentSidecarActionAtMs = 0
  sidecarObserveInFlight = false
}

export function getLastHy2ParentSidecarDetectLogAtMsForTests(): number {
  return lastHy2ParentSidecarActionAtMs
}

async function appendSidecarLog(line: string): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

async function maybeResetHy2ParentChainBirth(input: {
  activeLeaf: string
  nowMs: number
  snapshot: TransportLongevityTruthSnapshot
  marathonActive: boolean
  recoveryIneffective: boolean
}): Promise<void> {
  if (
    isMarathonGlobalByteDeath({
      marathonActive: input.marathonActive,
      snapshot: input.snapshot,
      recoveryIneffective: input.recoveryIneffective,
    })
  ) {
    return
  }
  const { resetTransportLongevityHy2ParentChainBirth } = await import('./transportLongevityTruth')
  await resetTransportLongevityHy2ParentChainBirth(input.activeLeaf, input.nowMs)
}

async function closeUdpOutbound(connectionId: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const { mihomoCloseConnection } = await import('./mihomoApi')
    await mihomoCloseConnection(connectionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

export function resolveProactiveUdpClosePlan(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
  lastRotateActionAtMs: number
  /** R-41 emergency bypasses age gates, but never active critical-flow safety unless carrier quiesce. */
  emergencyStallEscalation?: boolean
  recoveryIneffective?: boolean
  marathonActive?: boolean
}): Hy2ParentSidecarPlan {
  const marathonGlobalByteDeath = isMarathonGlobalByteDeath({
    marathonActive: input.marathonActive === true,
    snapshot: input.snapshot,
    recoveryIneffective: input.recoveryIneffective === true || input.emergencyStallEscalation === true,
  })
  if (
    !input.emergencyStallEscalation &&
    !marathonGlobalByteDeath &&
    input.snapshot.outboundHy2SessionAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS &&
    input.snapshot.httpParentChainAgeMs < HY2_PARENT_PROACTIVE_ROTATE_AGE_MS
  ) {
    return { action: 'none', reason: 'session_and_http_chain_below_proactive_rotate' }
  }
  if (
    !marathonGlobalByteDeath &&
    input.nowMs - input.lastRotateActionAtMs < HY2_PARENT_SIDECAR_COOLDOWN_MS
  ) {
    return { action: 'none', reason: 'proactive_rotate_cooldown' }
  }
  const activeInner = countActiveInnerCriticalFlows({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
  })
  const carrierQuiesce = resolveCarrierQuiesceRefreshDecision({
    snapshot: input.snapshot,
    activeInnerCriticalCount: activeInner,
    recoveryIneffective: input.recoveryIneffective === true || input.emergencyStallEscalation === true,
    marathonActive: input.marathonActive === true,
  })
  // Parent UDP owns every inner stream. Byte silence during model thinking is valid,
  // unless carrier quiesce proves byte-frozen dead carrier (Phase B).
  if (activeInner > 0 && !carrierQuiesce.bypassActiveInner) {
    return { action: 'none', reason: 'active_inner_critical_flows', healthyInnerCount: activeInner }
  }
  const udpResolution = resolveHy2ParentUdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    nowMs: input.nowMs,
    byteDeathFullScan: marathonGlobalByteDeath,
  })
  if (!udpResolution.connectionId) {
    return { action: 'none', reason: 'no_udp_outbound' }
  }
  const refreshReason = carrierQuiesce.bypassActiveInner
    ? 'carrier_quiesce_parent_udp_refresh'
    : 'proactive_parent_udp_refresh'
  return {
    action: 'close_udp_outbound',
    reason:
      udpResolution.source === 'mihomo_udp_chain_hop'
        ? `${refreshReason}_chain_hop`
        : refreshReason,
    udpConnectionId: udpResolution.connectionId,
    healthyInnerCount: activeInner,
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
  /** R-41: emergency stall escalation bypasses marathon inactive / 4h gates. */
  emergencyStallEscalation?: boolean
  recoveryIneffective?: boolean
}): Promise<Hy2ParentSidecarExecutionResult> {
  const nowMs = input.nowMs ?? Date.now()
  if (sidecarObserveInFlight) {
    return { outcome: 'skipped', action: 'none', reason: 'sidecar_in_flight' }
  }
  sidecarObserveInFlight = true
  try {
    const marathonActive = input.marathonTruth.marathonTruthActive
    const marathonGlobalByteDeath = isMarathonGlobalByteDeath({
      marathonActive,
      snapshot: input.snapshot,
      recoveryIneffective:
        input.recoveryIneffective === true || input.emergencyStallEscalation === true,
    })
    const dialPlan = resolveHy2ParentSidecarDialPlan({
      snapshot: input.snapshot,
      marathonTruthActive: marathonActive,
      lastSidecarDialAtMs: lastHy2ParentSidecarActionAtMs,
      nowMs,
      emergencyStallEscalation: input.emergencyStallEscalation === true,
      marathonGlobalByteDeath,
    })
    const rotatePlan = resolveProactiveUdpClosePlan({
      snapshot: input.snapshot,
      connections: input.connections,
      trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
      trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
      nowMs,
      lastRotateActionAtMs: lastHy2ParentSidecarActionAtMs,
      emergencyStallEscalation: input.emergencyStallEscalation === true,
      recoveryIneffective: input.recoveryIneffective === true,
      marathonActive,
    })

    const carrierQuiesce = resolveCarrierQuiesceRefreshDecision({
      snapshot: input.snapshot,
      activeInnerCriticalCount: countActiveInnerCriticalFlows({
        connections: input.connections,
        activeLeaf: input.snapshot.activeHy2Leaf,
      }),
      recoveryIneffective:
        input.recoveryIneffective === true || input.emergencyStallEscalation === true,
      marathonActive,
    })
    if (
      carrierQuiesce.bypassActiveInner &&
      rotatePlan.action === 'close_udp_outbound'
    ) {
      await appendSidecarLog(
        formatCarrierQuiesceRefreshLogLine({
          outcome: 'planned',
          reason: carrierQuiesce.reason,
          activeInnerCriticalCount: countActiveInnerCriticalFlows({
            connections: input.connections,
            activeLeaf: input.snapshot.activeHy2Leaf,
          }),
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          maxByteStallMs: input.snapshot.maxByteStallMs,
          frozenQuicCursorCount: input.snapshot.frozenQuicCursorCount,
        }),
      )
    }

    const shouldAct =
      dialPlan.action === 'sidecar_dial' || rotatePlan.action === 'close_udp_outbound'
    if (!shouldAct) {
      if (
        marathonGlobalByteDeath &&
        input.snapshot.maxByteStallMs >= 90_000
      ) {
        await appendSidecarLog(
          `[Hy2ParentSidecar]: outcome=skipped action=none reason=byte_death_no_action ` +
            `dial=${dialPlan.reason} rotate=${rotatePlan.reason} ` +
            `max_byte_stall_ms=${input.snapshot.maxByteStallMs} ` +
            `http_parent_chain_age_ms=${input.snapshot.httpParentChainAgeMs} ` +
            `frozen_quic_cursor=${input.snapshot.frozenQuicCursorCount}\n`,
        )
      }
      return {
        outcome: 'skipped',
        action: 'none',
        reason: `${dialPlan.reason}:${rotatePlan.reason}`,
      }
    }
    if (
      !marathonGlobalByteDeath &&
      nowMs - lastHy2ParentSidecarActionAtMs < SIDECAR_ACTION_COOLDOWN_MS
    ) {
      return { outcome: 'skipped', action: 'none', reason: 'sidecar_action_cooldown' }
    }

    let parentUdpClosedThisInvocation = false

    if (
      rotatePlan.action === 'close_udp_outbound' &&
      rotatePlan.udpConnectionId
    ) {
      const activeLeaf = input.snapshot.activeHy2Leaf?.trim() ?? 'JP-VPS-HY2'
      const closed = await closeUdpOutbound(rotatePlan.udpConnectionId)
      if (closed.ok) {
        parentUdpClosedThisInvocation = true
        await maybeResetHy2ParentChainBirth({
          activeLeaf,
          nowMs,
          snapshot: input.snapshot,
          marathonActive,
          recoveryIneffective:
            input.recoveryIneffective === true || input.emergencyStallEscalation === true,
        })
      }
      if (
        rotatePlan.reason.startsWith('carrier_quiesce_parent_udp_refresh')
      ) {
        await appendSidecarLog(
          formatCarrierQuiesceRefreshLogLine({
            outcome: closed.ok ? 'executed' : 'failed',
            reason: rotatePlan.reason,
            activeInnerCriticalCount: rotatePlan.healthyInnerCount ?? 0,
            httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
            maxByteStallMs: input.snapshot.maxByteStallMs,
            frozenQuicCursorCount: input.snapshot.frozenQuicCursorCount,
            udpConnectionId: rotatePlan.udpConnectionId,
            err: closed.err,
          }),
        )
      }
      lastHy2ParentSidecarActionAtMs = nowMs
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: closed.ok ? 'executed' : 'failed',
          action: 'close_udp_outbound',
          reason: `${rotatePlan.reason} phase=execute`,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          healthyInnerCount: rotatePlan.healthyInnerCount,
          udpConnectionId: rotatePlan.udpConnectionId,
          err: closed.err,
        }),
      )
      if (!closed.ok) {
        return {
          outcome: 'failed',
          action: 'close_udp_outbound',
          reason: closed.err ?? rotatePlan.reason,
        }
      }
      if (dialPlan.action !== 'sidecar_dial') {
        return {
          outcome: 'executed',
          action: 'close_udp_outbound',
          reason: rotatePlan.reason,
        }
      }
    }

    if (dialPlan.action === 'sidecar_dial') {
      const activeLeaf = input.snapshot.activeHy2Leaf?.trim() ?? 'JP-VPS-HY2'
      if (
        marathonGlobalByteDeath &&
        rotatePlan.action === 'none' &&
        rotatePlan.reason === 'no_udp_outbound'
      ) {
        await appendSidecarLog(
          `[Hy2ParentSidecar]: outcome=planned action=sidecar_dial reason=byte_death_no_udp_outbound_sidecar_emergency ` +
            `max_byte_stall_ms=${input.snapshot.maxByteStallMs} ` +
            `frozen_quic_cursor=${input.snapshot.frozenQuicCursorCount} ` +
            `cursor_conn=${input.cursorConnectionCount}\n`,
        )
        const mutation = await executeByteDeathParentMutation({
          activeLeaf,
          connections: input.connections,
          trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
          nowMs,
          maxByteStallMs: input.snapshot.maxByteStallMs,
          cursorConnectionCount: input.cursorConnectionCount,
        })
        if (mutation.mutated) {
          parentUdpClosedThisInvocation = true
          await maybeResetHy2ParentChainBirth({
            activeLeaf,
            nowMs,
            snapshot: input.snapshot,
            marathonActive,
            recoveryIneffective:
              input.recoveryIneffective === true || input.emergencyStallEscalation === true,
          })
        } else {
          lastHy2ParentSidecarActionAtMs = nowMs
          const blockReason = mutation.err ?? mutation.plan.reason
          await appendSidecarLog(
            formatHy2ParentSidecarLogLine({
              outcome: 'failed',
              action: 'sidecar_dial',
              reason: `byte_death_mutation_failed_blocking_sidecar phase=execute plan=${mutation.plan.action}`,
              outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
              httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
              err: blockReason,
            }),
          )
          return {
            outcome: 'failed',
            action: 'sidecar_dial',
            reason: blockReason,
          }
        }
      }
      const { runHy2TunnelVitalityIfDue } = await import('./hy2TunnelVitality')
      const vitality = await runHy2TunnelVitalityIfDue(
        activeLeaf,
        input.cursorConnectionCount,
        nowMs,
        input.marathonTruth,
        {
          sidecarDial: true,
          emergencySidecar:
            input.emergencyStallEscalation === true ||
            (marathonGlobalByteDeath && rotatePlan.reason === 'no_udp_outbound'),
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          stallRecoveryBypass: true,
        },
      )
      lastHy2ParentSidecarActionAtMs = nowMs
      const probeOnlyFalseSuccess =
        marathonGlobalByteDeath &&
        !parentUdpClosedThisInvocation &&
        vitality.outcome === 'executed'
      const sidecarReason =
        marathonGlobalByteDeath && rotatePlan.reason === 'no_udp_outbound'
          ? 'byte_death_no_udp_outbound_sidecar_emergency'
          : dialPlan.reason
      const resolvedReason = probeOnlyFalseSuccess
        ? 'byte_death_probe_only_without_udp_close'
        : sidecarReason
      const resolvedOutcome = probeOnlyFalseSuccess
        ? 'failed'
        : vitality.outcome === 'executed'
          ? 'executed'
          : 'failed'
      await appendSidecarLog(
        formatHy2ParentSidecarLogLine({
          outcome: resolvedOutcome,
          action: 'sidecar_dial',
          reason: `${resolvedReason} phase=execute`,
          outboundHy2SessionAgeMs: input.snapshot.outboundHy2SessionAgeMs,
          httpParentChainAgeMs: input.snapshot.httpParentChainAgeMs,
          connectPathDelayMs: vitality.connectPathDelayMs,
          err: vitality.err,
        }),
      )
      return {
        outcome: resolvedOutcome,
        action: 'sidecar_dial',
        reason:
          resolvedOutcome === 'executed'
            ? sidecarReason
            : vitality.err ?? resolvedReason,
      }
    }

    return { outcome: 'skipped', action: 'none', reason: 'no_executable_sidecar_action' }
  } finally {
    sidecarObserveInFlight = false
  }
}
