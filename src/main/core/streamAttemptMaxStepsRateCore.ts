// [INPUT] ValidatedLedgerTerminalRow · AgentTransportFailureRow · MarathonSegmentCacheRecord
// [OUTPUT] computeStreamAttemptMaxStepsRateSnapshot
// [POS] P28b SSOT — rolling last 100 stream attempts (incl. reconnects), observe-only SLO.

import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import {
  isMaxStepsLedgerTerminal,
  type ValidatedLedgerTerminalRow,
} from './validatedLedgerTerminalCore'
import { isMaxStepsTerminalRow, MAX_STEPS_RATE_TARGET_PCT } from './maxStepsRateObserverCore'

export const STREAM_ATTEMPT_RATE_ROLLING_LIMIT = 100
export const STREAM_ATTEMPT_RATE_LOOKBACK_MS = 7 * 86_400_000

export interface StreamAttemptWindowStats {
  windowLabel: string
  startedAttempts: number
  completedAttempts: number
  maxStepsAttempts: number
  earlyDisconnectAttempts: number
  inProgressAttempts: number
  attemptRatePct: number
}

export interface StreamAttemptMaxStepsRateSnapshot {
  primary: StreamAttemptWindowStats
  targetPct: number
  belowTarget: boolean
  ledgerAttemptCount: number
}

export function buildStreamAttemptKey(input: {
  originalRequestId: string
  requestId?: string
  attempt?: number
}): string {
  const requestId = String(input.requestId ?? '').trim()
  if (requestId) {
    return `req:${requestId}`
  }
  const originalRequestId = String(input.originalRequestId ?? '').trim()
  const attempt = typeof input.attempt === 'number' ? input.attempt : 0
  return `turn:${originalRequestId}:${attempt}`
}

interface AttemptTerminal {
  key: string
  ts: number
  isMaxSteps: boolean
  source: 'ledger' | 'jsonl'
}

function ledgerRowToAttemptTerminal(row: ValidatedLedgerTerminalRow): AttemptTerminal {
  return {
    key: buildStreamAttemptKey(row),
    ts: row.ts,
    isMaxSteps: isMaxStepsLedgerTerminal(row),
    source: 'ledger',
  }
}

function jsonlRowToAttemptTerminal(row: AgentTransportFailureRow): AttemptTerminal | undefined {
  const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
  if (!originalRequestId) {
    return undefined
  }
  const ts = typeof row.ts === 'number' ? row.ts : 0
  if (ts <= 0) {
    return undefined
  }
  return {
    key: buildStreamAttemptKey({
      originalRequestId,
      requestId: row.requestId,
      attempt: row.attempt,
    }),
    ts,
    isMaxSteps: isMaxStepsTerminalRow(row),
    source: 'jsonl',
  }
}

function mergeAttemptTerminals(
  ledgerRows: readonly ValidatedLedgerTerminalRow[],
  jsonlRows: readonly AgentTransportFailureRow[],
): AttemptTerminal[] {
  const byKey = new Map<string, AttemptTerminal>()
  for (const row of jsonlRows) {
    const terminal = jsonlRowToAttemptTerminal(row)
    if (!terminal) {
      continue
    }
    const prev = byKey.get(terminal.key)
    if (!prev || terminal.ts >= prev.ts) {
      byKey.set(terminal.key, terminal)
    }
  }
  for (const row of ledgerRows) {
    const terminal = ledgerRowToAttemptTerminal(row)
    const prev = byKey.get(terminal.key)
    if (!prev || terminal.ts >= prev.ts || (terminal.isMaxSteps && !prev.isMaxSteps)) {
      byKey.set(terminal.key, terminal)
    }
  }
  return [...byKey.values()].sort((a, b) => b.ts - a.ts)
}

function collectInProgressAttemptKeys(
  segments: readonly MarathonSegmentCacheRecord[],
  completedKeys: ReadonlySet<string>,
  sinceMs: number,
): Set<string> {
  const inProgress = new Set<string>()
  for (const segment of segments) {
    if (segment.httpStartMs < sinceMs) {
      continue
    }
    const key = buildStreamAttemptKey({
      originalRequestId: segment.originalRequestId,
      requestId: segment.requestId,
    })
    if (!completedKeys.has(key)) {
      inProgress.add(key)
    }
  }
  return inProgress
}

function pct(maxStepsAttempts: number, startedAttempts: number): number {
  return startedAttempts > 0 ? Math.round((maxStepsAttempts / startedAttempts) * 1000) / 10 : 0
}

export function computeStreamAttemptMaxStepsRateSnapshot(
  ledgerRows: readonly ValidatedLedgerTerminalRow[],
  jsonlRows: readonly AgentTransportFailureRow[],
  segments: readonly MarathonSegmentCacheRecord[],
  nowMs: number,
  rollingLimit: number = STREAM_ATTEMPT_RATE_ROLLING_LIMIT,
  lookbackMs: number = STREAM_ATTEMPT_RATE_LOOKBACK_MS,
): StreamAttemptMaxStepsRateSnapshot {
  const lookbackSinceMs = nowMs - lookbackMs
  const merged = mergeAttemptTerminals(
    ledgerRows.filter((row) => row.ts >= lookbackSinceMs),
    jsonlRows.filter((row) => (typeof row.ts === 'number' ? row.ts : 0) >= lookbackSinceMs),
  )

  const rollingCompleted = merged.slice(0, rollingLimit)
  const completedKeys = new Set(rollingCompleted.map((row) => row.key))
  const inProgressKeys = collectInProgressAttemptKeys(segments, completedKeys, lookbackSinceMs)

  let maxStepsAttempts = 0
  let earlyDisconnectAttempts = 0
  for (const terminal of rollingCompleted) {
    if (terminal.isMaxSteps) {
      maxStepsAttempts += 1
    } else {
      earlyDisconnectAttempts += 1
    }
  }

  const startedAttempts = rollingCompleted.length + inProgressKeys.size

  const primary: StreamAttemptWindowStats = {
    windowLabel: `attemptRolling${rollingLimit}`,
    startedAttempts,
    completedAttempts: rollingCompleted.length,
    maxStepsAttempts,
    earlyDisconnectAttempts,
    inProgressAttempts: inProgressKeys.size,
    attemptRatePct: pct(maxStepsAttempts, startedAttempts),
  }

  return {
    primary,
    targetPct: MAX_STEPS_RATE_TARGET_PCT,
    belowTarget: startedAttempts > 0 && primary.attemptRatePct < MAX_STEPS_RATE_TARGET_PCT,
    ledgerAttemptCount: ledgerRows.length,
  }
}

export function formatStreamAttemptMaxStepsRateLogSuffix(
  snapshot: StreamAttemptMaxStepsRateSnapshot,
): string {
  const p = snapshot.primary
  return (
    ` attempts_started=${p.startedAttempts}` +
    ` attempts_completed=${p.completedAttempts}` +
    ` attempts_max_steps=${p.maxStepsAttempts}` +
    ` attempts_early_disconnect=${p.earlyDisconnectAttempts}` +
    ` attempts_in_progress=${p.inProgressAttempts}` +
    ` attempt_rate_pct=${p.attemptRatePct.toFixed(1)}` +
    ` attempt_target_pct=${snapshot.targetPct}` +
    ` below_target_attempt=${snapshot.belowTarget ? 1 : 0}` +
    ` ledger_attempts=${snapshot.ledgerAttemptCount}`
  )
}
