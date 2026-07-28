// [INPUT] marathonSessionDialExecutorCore · cursorHy2MarathonKeepaliveCore · marathonObservabilityDialBudget
// [OUTPUT] executeMarathonWarmthDial
// [POS] P19 — periodic/high_latency warmth dial with P12 budget.

import { appendAppLog } from '../utils/log'
import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
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
  getLastHy2SessionKeepaliveAtMs,
  releaseHy2SessionDialInFlight,
  runHy2SessionNudgeDialPair,
  setLastHy2SessionKeepaliveAtMs,
  tryAcquireHy2SessionDialInFlight,
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
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: session_transport_nudge_deferred_cursor_load node=${activeNode} cursor_conn=${cursorConnectionCount} trigger=${trigger}\n`,
    )
    return { outcome: 'skipped_deferred' }
  }

  if (!tryAcquireHy2SessionDialInFlight()) {
    return { outcome: 'skipped_in_flight' }
  }

  try {
    const runSessionNudgeDial = () => runHy2SessionNudgeDialPair(activeNode, undefined)
    const { resolveMarathonObservabilityDialContext, withMarathonObservabilityDialBudget } =
      await import('./marathonObservabilityDialBudget')
    const dialContext = await resolveMarathonObservabilityDialContext()
    const budgetResult = await withMarathonObservabilityDialBudget(
      'session_nudge',
      dialContext,
      runSessionNudgeDial,
    )
    if (budgetResult.outcome === 'skipped_busy' || budgetResult.value === null) {
      return { outcome: 'skipped_budget_busy' }
    }

    const { api2Result, api2geoResult } = budgetResult.value
  const api2DelayMs = typeof api2Result.delay === 'number' ? api2Result.delay : 0
  const api2geoDelayMs = typeof api2geoResult.delay === 'number' ? api2geoResult.delay : 0
  const delayMs = Math.max(api2DelayMs, api2geoDelayMs)
  if (delayMs <= 0) {
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: session_transport_nudge_weak node=${activeNode} cursor_conn=${cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs} msg=${api2Result.message ?? api2geoResult.message ?? 'none'}\n`,
    )
    return {
      outcome: 'skipped_weak_probe',
      api2DelayMs,
      api2geoDelayMs,
    }
  }

  setLastHy2SessionKeepaliveAtMs(nowMs)
  const logKind = resolveMarathonWarmthLogKind(trigger)
  await appendAppLog(
    `[CursorHy2MarathonKeepalive]: ${logKind} node=${activeNode} cursor_conn=${cursorConnectionCount} api2_delay_ms=${api2DelayMs} api2geo_delay_ms=${api2geoDelayMs}\n`,
  )
  const { appendApi2ProbeLedgerRow } = await import('./api2ProbeLedgerCore')
  await appendApi2ProbeLedgerRow({
    ts: new Date(nowMs).toISOString(),
    scope: 'active',
    node: activeNode,
    latency_ms: delayMs,
    ok: true,
    authoritative: true,
    method: 'session_nudge',
    probe_via: `mihomo_node:${activeNode}`,
    error_detail: `${logKind} api2=${api2DelayMs} api2geo=${api2geoDelayMs}`,
  })
  return {
    outcome: 'executed',
    api2DelayMs,
    api2geoDelayMs,
  }
  } catch (error) {
    const err = formatUnknownErrorForLog(error)
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: session_transport_nudge_failed node=${activeNode} cursor_conn=${cursorConnectionCount} err=${err}\n`,
    )
    const { recoverMihomoApiAfterNudgeFailure } = await import('./mihomoApiSocketWatchdog')
    await recoverMihomoApiAfterNudgeFailure(error)
    return { outcome: 'failed', err }
  } finally {
    releaseHy2SessionDialInFlight()
  }
}
