// [INPUT] marathonSessionDialExecutorCore · cursorHy2MarathonKeepaliveCore · dialAdmissionArbiter
// [OUTPUT] executeMarathonWarmthDial
// [POS] P19 — periodic/high_latency warmth dial with P12 budget + P10-2 admission.

import { appendAppLog } from '../utils/log'
import {
  CURSOR_HY2_HIGH_LATENCY_FORCE_MIN_INTERVAL_MS,
  isMarathonQuIcInboundCursorNode,
  resolveMarathonWarmthLogKind,
  shouldDeferMarathonWarmth,
  shouldRunHy2MarathonSessionKeepalive,
  type MarathonSessionKeepaliveResult,
  type MarathonWarmthTrigger,
} from './cursorHy2MarathonKeepaliveCore'
import { resolveCursorDedicatedActiveNode } from './cursorDedicatedNodeResolver'
import {
  buildRecoveryIncidentGeneration,
  completeDialIntent,
} from './dialAdmissionArbiter'
import type { DialAdmissionOutcome } from './dialAdmissionArbiterCore'
import {
  executeHy2SessionDialWithGuard,
  getLastHy2SessionKeepaliveAtMs,
  isSkipMarathonSessionDialAppLogForTests,
} from './marathonSessionDialExecutorCore'

export interface MarathonWarmthDialRequest {
  trigger: MarathonWarmthTrigger
  nowMs?: number
}

function shouldApplyWarmthCooldown(trigger: MarathonWarmthTrigger, nowMs: number): boolean {
  const lastAt = getLastHy2SessionKeepaliveAtMs()
  if (lastAt <= 0) {
    return false
  }
  if (trigger === 'high_latency_warmth') {
    return nowMs - lastAt < CURSOR_HY2_HIGH_LATENCY_FORCE_MIN_INTERVAL_MS
  }
  return false
}

function mapWarmthAdmissionOutcome(result: MarathonSessionKeepaliveResult): DialAdmissionOutcome {
  if (result.outcome === 'executed') {
    return 'SUCCESS'
  }
  if (result.outcome === 'skipped_weak_probe' || result.outcome === 'skipped_budget_busy') {
    return 'INEFFECTIVE'
  }
  return 'INCONCLUSIVE'
}

export async function executeMarathonWarmthDial(
  cursorConnectionCount: number,
  request: MarathonWarmthDialRequest,
): Promise<MarathonSessionKeepaliveResult> {
  const trigger = request.trigger
  const nowMs = request.nowMs ?? Date.now()
  const activeNode = await resolveCursorDedicatedActiveNode()
  if (!activeNode || !isMarathonQuIcInboundCursorNode(activeNode)) {
    return { outcome: 'skipped_no_quic_node' }
  }

  if (
    trigger === 'periodic_session' &&
    !shouldRunHy2MarathonSessionKeepalive({
      activeNode,
      cursorConnectionCount,
      lastKeepaliveAtMs: getLastHy2SessionKeepaliveAtMs(),
      nowMs,
    })
  ) {
    return { outcome: 'skipped_not_due' }
  }

  if (shouldApplyWarmthCooldown(trigger, nowMs)) {
    return { outcome: 'skipped_cooldown' }
  }

  if (shouldDeferMarathonWarmth(cursorConnectionCount, trigger)) {
    if (!isSkipMarathonSessionDialAppLogForTests()) {
      await appendAppLog(
        `[CursorHy2MarathonKeepalive]: session_transport_nudge_deferred_cursor_load node=${activeNode} cursor_conn=${cursorConnectionCount} trigger=${trigger}\n`,
      )
    }
    return { outcome: 'skipped_deferred' }
  }

  const incidentGeneration = buildRecoveryIncidentGeneration(trigger, undefined, nowMs)
  const dialId = `${trigger}:${incidentGeneration}:${nowMs}`
  const logKind = resolveMarathonWarmthLogKind(trigger)
  const result = await executeHy2SessionDialWithGuard({
    activeNode,
    cursorConnectionCount,
    nowMs,
    delayOptions: { purpose: 'session_nudge' },
    logKind,
    weakProbeLogPrefix: 'session_transport_nudge_weak',
    useObservabilityBudget: true,
    admissionIntent: {
      dialId,
      class: 'active_recovery',
      caller: 'marathonWarmthDialExecutor',
      incidentGeneration,
      node: activeNode,
      submittedAtMs: nowMs,
    },
  })

  if (result.outcome !== 'skipped_admission') {
    completeDialIntent(dialId, incidentGeneration, mapWarmthAdmissionOutcome(result))
  }
  return result
}
