// [INPUT] MarathonSegmentCacheRecord · AgentTransportFailureRow
// [OUTPUT] computeMaxStepsRateSnapshot
// [POS] P28 observe-only — max-steps terminal rate; primary SLO = rolling last 100 turns.

import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'

export const MAX_STEPS_RATE_ROLLING_TURN_LIMIT = 100
export const MAX_STEPS_RATE_AUX_WINDOW_MS = 86_400_000
export const MAX_STEPS_RATE_TARGET_PCT = 90
/** Read enough history to fill rolling-100 even on low-volume days. */
export const MAX_STEPS_RATE_LOOKBACK_MS = 7 * 86_400_000

export interface MaxStepsRateWindowStats {
  windowLabel: string
  startedTurns: number
  completedTurns: number
  maxStepsTurns: number
  earlyDisconnectTurns: number
  inProgressTurns: number
  maxStepsRatePct: number
}

export interface MaxStepsRateSnapshot {
  primary: MaxStepsRateWindowStats
  aux24h: MaxStepsRateWindowStats
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

function collectTurnStarts(
  segments: readonly MarathonSegmentCacheRecord[],
  sinceMs: number,
): Map<string, MarathonSegmentCacheRecord> {
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
  return startedByOriginal
}

function latestTerminalByOriginalRequestId(
  rows: readonly AgentTransportFailureRow[],
): Map<string, AgentTransportFailureRow> {
  const latest = new Map<string, AgentTransportFailureRow>()
  for (const row of rows) {
    const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
    if (!originalRequestId) {
      continue
    }
    const ts = typeof row.ts === 'number' ? row.ts : 0
    const prev = latest.get(originalRequestId)
    if (!prev || ts >= (prev.ts ?? 0)) {
      latest.set(originalRequestId, row)
    }
  }
  return latest
}

function classifyTurns(
  startedByOriginal: ReadonlyMap<string, MarathonSegmentCacheRecord>,
  terminals: ReadonlyMap<string, AgentTransportFailureRow>,
): Omit<MaxStepsRateWindowStats, 'windowLabel' | 'maxStepsRatePct'> {
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
  return {
    startedTurns,
    completedTurns,
    maxStepsTurns,
    earlyDisconnectTurns,
    inProgressTurns: Math.max(0, startedTurns - completedTurns),
  }
}

function pct(maxStepsTurns: number, startedTurns: number): number {
  return startedTurns > 0 ? Math.round((maxStepsTurns / startedTurns) * 1000) / 10 : 0
}

function buildWindowStats(
  label: string,
  counts: Omit<MaxStepsRateWindowStats, 'windowLabel' | 'maxStepsRatePct'>,
): MaxStepsRateWindowStats {
  return {
    windowLabel: label,
    ...counts,
    maxStepsRatePct: pct(counts.maxStepsTurns, counts.startedTurns),
  }
}

function selectRollingTurnStarts(
  startedByOriginal: ReadonlyMap<string, MarathonSegmentCacheRecord>,
  limit: number,
): Map<string, MarathonSegmentCacheRecord> {
  const sorted = [...startedByOriginal.values()].sort((a, b) => b.httpStartMs - a.httpStartMs)
  const selected = new Map<string, MarathonSegmentCacheRecord>()
  for (const record of sorted.slice(0, limit)) {
    selected.set(record.originalRequestId, record)
  }
  return selected
}

export function computeMaxStepsRateSnapshot(
  segments: readonly MarathonSegmentCacheRecord[],
  failureRows: readonly AgentTransportFailureRow[],
  nowMs: number,
  rollingLimit: number = MAX_STEPS_RATE_ROLLING_TURN_LIMIT,
  auxWindowMs: number = MAX_STEPS_RATE_AUX_WINDOW_MS,
  lookbackMs: number = MAX_STEPS_RATE_LOOKBACK_MS,
): MaxStepsRateSnapshot {
  const lookbackSinceMs = nowMs - lookbackMs
  const auxSinceMs = nowMs - auxWindowMs
  const allStarts = collectTurnStarts(segments, lookbackSinceMs)
  const terminals = latestTerminalByOriginalRequestId(failureRows)

  const rollingStarts = selectRollingTurnStarts(allStarts, rollingLimit)
  const auxStarts = collectTurnStarts(segments, auxSinceMs)

  const primary = buildWindowStats(
    `rolling${rollingLimit}`,
    classifyTurns(rollingStarts, terminals),
  )
  const aux24h = buildWindowStats('24h', classifyTurns(auxStarts, terminals))

  return {
    primary,
    aux24h,
    targetPct: MAX_STEPS_RATE_TARGET_PCT,
    belowTarget: primary.startedTurns > 0 && primary.maxStepsRatePct < MAX_STEPS_RATE_TARGET_PCT,
  }
}

export function formatMaxStepsRateLogLine(snapshot: MaxStepsRateSnapshot): string {
  const p = snapshot.primary
  const a = snapshot.aux24h
  return (
    `[MaxStepsRate]: window=${p.windowLabel}` +
    ` started=${p.startedTurns}` +
    ` completed=${p.completedTurns}` +
    ` max_steps=${p.maxStepsTurns}` +
    ` early_disconnect=${p.earlyDisconnectTurns}` +
    ` in_progress=${p.inProgressTurns}` +
    ` rate_pct=${p.maxStepsRatePct.toFixed(1)}` +
    ` window_h=24 started_24h=${a.startedTurns}` +
    ` max_steps_24h=${a.maxStepsTurns}` +
    ` early_disconnect_24h=${a.earlyDisconnectTurns}` +
    ` rate_pct_24h=${a.maxStepsRatePct.toFixed(1)}` +
    ` target_pct=${snapshot.targetPct}` +
    ` below_target=${snapshot.belowTarget ? 1 : 0}` +
    ` cursor_app=3.1.15 observe_only=1\n`
  )
}
