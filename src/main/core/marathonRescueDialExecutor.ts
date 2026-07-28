// [INPUT] marathonSessionDialExecutorCore · cursorHy2MarathonKeepaliveCore
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
}

function shouldApplyRescueCooldown(trigger: MarathonWarmthTrigger, nowMs: number): boolean {
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
    shouldDeferMarathonWarmth(cursorConnectionCount, trigger, {
      maxGapMs: request.maxGapMs,
      staleRequestIdCount: request.staleRequestIdCount,
    })
  ) {
    return { outcome: 'skipped_deferred' }
  }

  const logKind = resolveMarathonWarmthLogKind(trigger)
  const result = await executeHy2SessionDialWithGuard({
    activeNode,
    cursorConnectionCount,
    nowMs,
    delayOptions: { purpose: 'marathon_rescue' },
    logKind,
    weakProbeLogPrefix: `${logKind}_weak`,
    forceOnWeakProbe: true,
  })

  if (!isSkipMarathonSessionDialAppLogForTests()) {
    const { appendAppLog } = await import('../utils/log')
    await appendAppLog(formatMarathonRescueDialLogLine(trigger, result, cursorConnectionCount))
  }
  return result
}
