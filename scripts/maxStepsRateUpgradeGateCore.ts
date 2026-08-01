/** R-35c — block Sparkle upgrade ship when rolling attempt max-steps SLO is below target. */

import {
  G9_SOAK_MIN_ATTEMPTS,
  G9_SOAK_TARGET_RATE_PCT,
} from './g9SoakMonitorCore'

export interface MaxStepsRateUpgradeGateInput {
  /** Latest `[MaxStepsRate]` log line, if any. */
  maxStepsLogLine: string | null
  /** Optional override from snapshot jsonl tail. */
  snapshotAttemptRatePct: number | null
  /** When true, gate is advisory only (default false for strict release). */
  advisoryOnly?: boolean
}

export interface MaxStepsRateUpgradeGateResult {
  allowUpgrade: boolean
  reason: string
  attemptsStarted: number | null
  attemptRatePct: number | null
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

export function evaluateMaxStepsRateUpgradeGate(
  input: MaxStepsRateUpgradeGateInput,
): MaxStepsRateUpgradeGateResult {
  const attemptsStarted =
    parseIntField(input.maxStepsLogLine, 'cursor_requests_started') ??
    parseIntField(input.maxStepsLogLine, 'attempts_started')
  const attemptRatePct =
    parseFloatField(input.maxStepsLogLine, 'cursor_request_rate_pct') ??
    parseFloatField(input.maxStepsLogLine, 'attempt_rate_pct') ??
    input.snapshotAttemptRatePct
  const belowTargetRaw =
    input.maxStepsLogLine?.match(/below_target_cursor_request=(\d+)/)?.[1] ??
    input.maxStepsLogLine?.match(/below_target_attempt=(\d+)/)?.[1]
  const belowTarget = belowTargetRaw === '1'

  if (attemptsStarted == null || attemptsStarted < G9_SOAK_MIN_ATTEMPTS) {
    return {
      allowUpgrade: true,
      reason: 'insufficient_attempt_sample_for_gate',
      attemptsStarted,
      attemptRatePct,
    }
  }
  if (attemptRatePct == null) {
    return {
      allowUpgrade: input.advisoryOnly === true,
      reason: 'missing_attempt_rate_pct',
      attemptsStarted,
      attemptRatePct,
    }
  }
  if (attemptRatePct < G9_SOAK_TARGET_RATE_PCT || belowTarget) {
    return {
      allowUpgrade: input.advisoryOnly === true,
      reason: `attempt_rate_pct=${attemptRatePct.toFixed(1)} below target ${G9_SOAK_TARGET_RATE_PCT}`,
      attemptsStarted,
      attemptRatePct,
    }
  }
  return {
    allowUpgrade: true,
    reason: 'attempt_slo_gate_pass',
    attemptsStarted,
    attemptRatePct,
  }
}
