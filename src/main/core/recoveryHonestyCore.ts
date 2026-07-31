// [INPUT] recovery attempt records · post-hoc gap measurements
// [OUTPUT] evaluateRecoveryHonesty · formatRecoveryHonestyLogLine
// [POS] R-34d SSOT — success = affected max_gap_ms drops ≥50% within 60s (not executed logs).

export const RECOVERY_HONESTY_EVAL_WINDOW_MS = 60_000
export const RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO = 0.5

export type RecoveryHonestyKind =
  | 'token_gap_rescue'
  | 'stall_prune'
  | 'hy2_parent_rotation'

export interface RecoveryHonestyAttemptRecord {
  kind: RecoveryHonestyKind
  attemptedAtMs: number
  baselineMaxGapMs: number
  staleRequestIds: readonly string[]
}

export interface RecoveryHonestyEvaluation {
  kind: RecoveryHonestyKind
  outcome: 'success' | 'ineffective'
  baselineMaxGapMs: number
  currentMaxGapMs: number
  elapsedMs: number
  staleRequestIds: readonly string[]
}

export function shouldEvaluateRecoveryHonesty(
  record: RecoveryHonestyAttemptRecord | undefined,
  nowMs: number,
): boolean {
  if (!record) {
    return false
  }
  const elapsedMs = nowMs - record.attemptedAtMs
  return elapsedMs >= 5_000 && elapsedMs <= RECOVERY_HONESTY_EVAL_WINDOW_MS + 5_000
}

export function evaluateRecoveryHonesty(input: {
  record: RecoveryHonestyAttemptRecord
  nowMs: number
  currentMaxGapMs: number
  staleRequestIds: readonly string[]
}): RecoveryHonestyEvaluation {
  const elapsedMs = input.nowMs - input.record.attemptedAtMs
  const baseline = Math.max(1, input.record.baselineMaxGapMs)
  const reducedEnough =
    input.currentMaxGapMs <= baseline * (1 - RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO)
  return {
    kind: input.record.kind,
    outcome: reducedEnough ? 'success' : 'ineffective',
    baselineMaxGapMs: input.record.baselineMaxGapMs,
    currentMaxGapMs: input.currentMaxGapMs,
    elapsedMs,
    staleRequestIds:
      input.staleRequestIds.length > 0 ? input.staleRequestIds : input.record.staleRequestIds,
  }
}

export function formatRecoveryHonestyLogLine(evaluation: RecoveryHonestyEvaluation): string {
  const stalePreview = evaluation.staleRequestIds.slice(0, 5).join(',')
  return (
    `[RecoveryHonesty]:` +
    ` kind=${evaluation.kind}` +
    ` outcome=${evaluation.outcome}` +
    ` baseline_max_gap_ms=${evaluation.baselineMaxGapMs}` +
    ` current_max_gap_ms=${evaluation.currentMaxGapMs}` +
    ` elapsed_ms=${evaluation.elapsedMs}` +
    ` stale_rids=${stalePreview}\n`
  )
}
