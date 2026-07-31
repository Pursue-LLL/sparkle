// [INPUT] MarathonSegmentCacheRecord · AgentTransportFailureRow
// [OUTPUT] computeMaxStepsRateSnapshot
// [POS] P28 observe-only — max-steps terminal rate vs all Cursor 3.1.15 userMessage turns (24h window).

import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'

export const MAX_STEPS_RATE_WINDOW_MS = 86_400_000
export const MAX_STEPS_RATE_TARGET_PCT = 90

export interface MaxStepsRateSnapshot {
  windowMs: number
  startedTurns: number
  completedTurns: number
  maxStepsTurns: number
  earlyDisconnectTurns: number
  inProgressTurns: number
  maxStepsRatePct: number
  targetPct: number
  belowTarget: boolean
}

export function isMaxStepsTerminalRow(row: AgentTransportFailureRow): boolean {
  const reasonSub = String(row.reasonSub ?? '').toLowerCase()
  if (reasonSub === 'max-steps-cap' || reasonSub === 'max-steps') {
    return true
  }
  const errMsg = String(row.errMsg ?? '')
  return /maximum number of steps/i.test(errMsg)
}

function isTurnStartSegment(record: MarathonSegmentCacheRecord): boolean {
  const actionCase = String(record.actionCase ?? '').toLowerCase()
  if (actionCase.includes('usermessage') || actionCase.includes('user-message')) {
    return true
  }
  return record.requestId === record.originalRequestId
}

function latestTerminalByOriginalRequestId(
  rows: readonly AgentTransportFailureRow[],
  sinceMs: number,
): Map<string, AgentTransportFailureRow> {
  const latest = new Map<string, AgentTransportFailureRow>()
  for (const row of rows) {
    const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
    if (!originalRequestId) {
      continue
    }
    const ts = typeof row.ts === 'number' ? row.ts : 0
    if (ts > 0 && ts < sinceMs) {
      continue
    }
    const prev = latest.get(originalRequestId)
    if (!prev || ts >= (prev.ts ?? 0)) {
      latest.set(originalRequestId, row)
    }
  }
  return latest
}

export function computeMaxStepsRateSnapshot(
  segments: readonly MarathonSegmentCacheRecord[],
  failureRows: readonly AgentTransportFailureRow[],
  nowMs: number,
  windowMs: number = MAX_STEPS_RATE_WINDOW_MS,
): MaxStepsRateSnapshot {
  const sinceMs = nowMs - windowMs
  const startedByOriginal = new Map<string, MarathonSegmentCacheRecord>()

  for (const segment of segments) {
    if (segment.httpStartMs < sinceMs || !isTurnStartSegment(segment)) {
      continue
    }
    const originalRequestId = String(segment.originalRequestId || segment.requestId).trim()
    if (!originalRequestId) {
      continue
    }
    const prev = startedByOriginal.get(originalRequestId)
    if (!prev || segment.httpStartMs < prev.httpStartMs) {
      startedByOriginal.set(originalRequestId, segment)
    }
  }

  const terminals = latestTerminalByOriginalRequestId(failureRows, sinceMs)
  let maxStepsTurns = 0
  let earlyDisconnectTurns = 0
  let completedTurns = 0

  for (const originalRequestId of startedByOriginal.keys()) {
    const terminal = terminals.get(originalRequestId)
    if (!terminal) {
      continue
    }
    completedTurns += 1
    if (isMaxStepsTerminalRow(terminal)) {
      maxStepsTurns += 1
    } else {
      earlyDisconnectTurns += 1
    }
  }

  const startedTurns = startedByOriginal.size
  const inProgressTurns = Math.max(0, startedTurns - completedTurns)
  const maxStepsRatePct =
    startedTurns > 0 ? Math.round((maxStepsTurns / startedTurns) * 1000) / 10 : 0

  return {
    windowMs,
    startedTurns,
    completedTurns,
    maxStepsTurns,
    earlyDisconnectTurns,
    inProgressTurns,
    maxStepsRatePct,
    targetPct: MAX_STEPS_RATE_TARGET_PCT,
    belowTarget: startedTurns > 0 && maxStepsRatePct < MAX_STEPS_RATE_TARGET_PCT,
  }
}

export function formatMaxStepsRateLogLine(snapshot: MaxStepsRateSnapshot): string {
  const windowHours = Math.round(snapshot.windowMs / 3_600_000)
  return (
    `[MaxStepsRate]: window_h=${windowHours}` +
    ` started=${snapshot.startedTurns}` +
    ` completed=${snapshot.completedTurns}` +
    ` max_steps=${snapshot.maxStepsTurns}` +
    ` early_disconnect=${snapshot.earlyDisconnectTurns}` +
    ` in_progress=${snapshot.inProgressTurns}` +
    ` rate_pct=${snapshot.maxStepsRatePct.toFixed(1)}` +
    ` target_pct=${snapshot.targetPct}` +
    ` below_target=${snapshot.belowTarget ? 1 : 0}` +
    ` cursor_app=3.1.15 observe_only=1\n`
  )
}
