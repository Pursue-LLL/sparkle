/** G9 soak pass criteria — attempt-level MaxStepsRate SLO (P28b primary). */

export const G9_SOAK_MIN_ATTEMPTS = 10
export const G9_SOAK_TARGET_RATE_PCT = 90

export interface G9SoakMonitorInput {
  maxStepsLogLine: string | null
  snapshotAttemptRatePct: number | null
}

export interface G9SoakMonitorMetrics {
  attemptsStarted: number | null
  attemptsEarlyDisconnect: number | null
  attemptRatePct: number | null
  belowTargetAttempt: boolean | null
  recoveryOutcome: string | null
}

function parseIntField(line: string | null, field: string): number | null {
  if (!line) {
    return null
  }
  const match = line.match(new RegExp(`${field}=(\\d+)`))
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function parseFloatField(line: string | null, field: string): number | null {
  if (!line) {
    return null
  }
  const match = line.match(new RegExp(`${field}=([\\d.]+)`))
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

export function parseG9SoakMetrics(
  maxStepsLogLine: string | null,
  recoveryLogLine: string | null,
  snapshotAttemptRatePct: number | null,
): G9SoakMonitorMetrics {
  const attemptRateFromLog = parseFloatField(maxStepsLogLine, 'attempt_rate_pct')
  const belowTargetRaw = maxStepsLogLine?.match(/below_target_attempt=(\d+)/)?.[1]
  return {
    attemptsStarted: parseIntField(maxStepsLogLine, 'attempts_started'),
    attemptsEarlyDisconnect: parseIntField(maxStepsLogLine, 'attempts_early_disconnect'),
    attemptRatePct: attemptRateFromLog ?? snapshotAttemptRatePct,
    belowTargetAttempt:
      belowTargetRaw === '1' ? true : belowTargetRaw === '0' ? false : null,
    recoveryOutcome: recoveryLogLine?.match(/outcome=(\w+)/)?.[1] ?? null,
  }
}

export function evaluateG9SoakPass(metrics: G9SoakMonitorMetrics): boolean {
  const { attemptsStarted, attemptRatePct, belowTargetAttempt } = metrics
  if (attemptsStarted == null || attemptsStarted < G9_SOAK_MIN_ATTEMPTS) {
    return false
  }
  if (attemptRatePct == null || attemptRatePct < G9_SOAK_TARGET_RATE_PCT) {
    return false
  }
  // Prefer Sparkle SSOT flag when present; fall back to rate threshold only.
  if (belowTargetAttempt === true) {
    return false
  }
  return true
}
