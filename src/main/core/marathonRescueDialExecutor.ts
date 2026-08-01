// [INPUT] marathonSessionDialExecutorCore · cursorHy2MarathonKeepaliveCore · dialAdmissionArbiter
// [OUTPUT] executeMarathonRescueDial
// [POS] P19 — MTDO inline rescue dial; no MTDO re-entrancy guard (G10 fix).

import {
  CURSOR_HY2_TOKEN_GAP_MIN_INTERVAL_MS,
  isMarathonQuIcInboundCursorNode,
  isMarathonRescueTrigger,
  resolveMarathonWarmthLogKind,
  shouldDeferMarathonWarmth,
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
  formatMarathonRescueDialLogLine,
  getLastHy2SessionKeepaliveAtMs,
  isSkipMarathonSessionDialAppLogForTests,
} from './marathonSessionDialExecutorCore'

export interface MarathonRescueDialRequest {
  trigger: MarathonWarmthTrigger
  nowMs?: number
  maxGapMs?: number
  staleRequestIdCount?: number
  staleRequestIds?: readonly string[]
}

function mapRescueDialAdmissionOutcome(
  result: MarathonSessionKeepaliveResult,
): DialAdmissionOutcome {
  if (result.outcome === 'executed') {
    return 'SUCCESS'
  }
  if (result.outcome === 'skipped_weak_probe') {
    return 'INEFFECTIVE'
  }
  return 'INCONCLUSIVE'
}

function shouldApplyRescueCooldown(trigger: MarathonWarmthTrigger, nowMs: number): boolean {
  if (trigger === 'hy2_parent_sidecar') {
    return false
  }
  if (trigger === 'connect_partition' || trigger === 'latency_delta_rescue') {
    return false
  }
  const lastAt = getLastHy2SessionKeepaliveAtMs()
  if (lastAt <= 0) {
    return false
  }
  if (
    trigger === 'token_gap' ||
    trigger === 'cold_resume' ||
    trigger === 'silent_generation_end' ||
    trigger === 'connect_path_partition'
  ) {
    return nowMs - lastAt < CURSOR_HY2_TOKEN_GAP_MIN_INTERVAL_MS
  }
  return false
}

export async function executeMarathonRescueDial(
  cursorConnectionCount: number,
  request: MarathonRescueDialRequest,
): Promise<MarathonSessionKeepaliveResult> {
  const trigger = request.trigger
  if (!isMarathonRescueTrigger(trigger)) {
    return { outcome: 'skipped_deferred' }
  }

  const nowMs = request.nowMs ?? Date.now()
  const activeNode = await resolveCursorDedicatedActiveNode()
  if (!activeNode || !isMarathonQuIcInboundCursorNode(activeNode)) {
    return { outcome: 'skipped_no_quic_node' }
  }

  if (shouldApplyRescueCooldown(trigger, nowMs)) {
    return { outcome: 'skipped_cooldown' }
  }

  if (
    trigger !== 'hy2_parent_sidecar' &&
    shouldDeferMarathonWarmth(cursorConnectionCount, trigger, {
      maxGapMs: request.maxGapMs,
      staleRequestIdCount: request.staleRequestIdCount,
    })
  ) {
    return { outcome: 'skipped_deferred' }
  }

  const logKind = resolveMarathonWarmthLogKind(trigger)
  const delayPurpose = trigger === 'hy2_parent_sidecar' ? 'hy2_parent_sidecar' : 'marathon_rescue'
  const incidentGeneration = buildRecoveryIncidentGeneration(
    trigger,
    request.staleRequestIds,
    nowMs,
  )
  const dialId = `${trigger}:${incidentGeneration}:${nowMs}`
  const result = await executeHy2SessionDialWithGuard({
    activeNode,
    cursorConnectionCount,
    nowMs,
    delayOptions: { purpose: delayPurpose },
    logKind,
    weakProbeLogPrefix: `${logKind}_weak`,
    forceOnWeakProbe: true,
    admissionIntent: {
      dialId,
      class: 'active_recovery',
      caller: 'marathonRescueDialExecutor',
      incidentGeneration,
      node: activeNode,
      submittedAtMs: nowMs,
    },
  })

  if (result.outcome !== 'skipped_admission') {
    completeDialIntent(dialId, incidentGeneration, mapRescueDialAdmissionOutcome(result))
  }

  if (!isSkipMarathonSessionDialAppLogForTests()) {
    const { appendAppLog } = await import('../utils/log')
    await appendAppLog(formatMarathonRescueDialLogLine(trigger, result, cursorConnectionCount))
  }
  return result
}
