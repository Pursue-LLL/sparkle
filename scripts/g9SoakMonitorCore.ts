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
  physicalValid?: boolean | null
  physicalSloInvalid?: boolean
  physicalInvalidReason?: string
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
  const physicalValidRaw = maxStepsLogLine?.match(/physical_valid=(\d+)/)?.[1]
  const physicalSloInvalidRaw = maxStepsLogLine?.match(/physical_slo_invalid=(\d+)/)?.[1]
  const physicalInvalidReason =
    maxStepsLogLine?.match(/physical_invalid_reason=([^\s]+)/)?.[1] ?? undefined
  const cursorRateFromLog = parseFloatField(maxStepsLogLine, 'cursor_request_rate_pct')
  const attemptRateFromLog = parseFloatField(maxStepsLogLine, 'attempt_rate_pct')
  const attemptRatePct = cursorRateFromLog ?? attemptRateFromLog ?? snapshotAttemptRatePct
  const belowTargetRaw =
    maxStepsLogLine?.match(/below_target_cursor_request=(\d+)/)?.[1] ??
    maxStepsLogLine?.match(/below_target_attempt=(\d+)/)?.[1]
  const requestsStarted =
    parseIntField(maxStepsLogLine, 'cursor_requests_started') ??
    parseIntField(maxStepsLogLine, 'attempts_started')
  const requestsEarlyDisconnect =
    parseIntField(maxStepsLogLine, 'cursor_requests_early_disconnect') ??
    parseIntField(maxStepsLogLine, 'attempts_early_disconnect')
  return {
    attemptsStarted: requestsStarted,
    attemptsEarlyDisconnect: requestsEarlyDisconnect,
    attemptRatePct,
    belowTargetAttempt:
      belowTargetRaw === '1' ? true : belowTargetRaw === '0' ? false : null,
    recoveryOutcome: recoveryLogLine?.match(/outcome=(\w+)/)?.[1] ?? null,
    physicalValid: physicalValidRaw === '1' ? true : physicalValidRaw === '0' ? false : null,
    physicalSloInvalid: physicalSloInvalidRaw === '1',
    physicalInvalidReason,
  }
}

export function evaluateG9SoakPass(metrics: G9SoakMonitorMetrics): boolean {
  const { attemptsStarted, attemptRatePct, belowTargetAttempt, physicalSloInvalid, physicalValid } =
    metrics
  if (physicalSloInvalid === true || physicalValid === false) {
    return false
  }
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
