// [INPUT] recovery attempt records · post-hoc gap measurements · carrier byte snapshots
// [OUTPUT] evaluateRecoveryHonesty · formatRecoveryHonestyLogLine
// [POS] R-34d SSOT — success = affected max_gap_ms drops ≥50% within 60s AND carrier bytes recover when required.

export const RECOVERY_HONESTY_EVAL_WINDOW_MS = 60_000
export const RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO = 0.5

export type RecoveryHonestyKind =
  | 'token_gap_rescue'
  | 'stall_prune'
  | 'hy2_parent_rotation'

export interface RecoveryHonestyCarrierSnapshot {
  upload: number
  download: number
}

export interface RecoveryHonestyAttemptRecord {
  kind: RecoveryHonestyKind
  attemptedAtMs: number
  baselineMaxGapMs: number
  staleRequestIds: readonly string[]
  /** Baseline mihomo upload/download on the affected carrier at rescue time. */
  baselineCarrier?: RecoveryHonestyCarrierSnapshot
  /** When true, gap reduction alone is insufficient — carrier bytes must change (split-brain guard). */
  requireCarrierBytesRecovery: boolean
  /** Optional connection id for post-hoc byte re-read at evaluation time. */
  connectionId?: string
}

export interface RecoveryHonestyEvaluation {
  kind: RecoveryHonestyKind
  outcome: 'success' | 'ineffective'
  baselineMaxGapMs: number
  currentMaxGapMs: number
  elapsedMs: number
  staleRequestIds: readonly string[]
  carrierRecovered: boolean
  gapReducedEnough: boolean
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

export function evaluateCarrierBytesRecovered(
  baseline: RecoveryHonestyCarrierSnapshot | undefined,
  current: RecoveryHonestyCarrierSnapshot | undefined,
  requireCarrierBytesRecovery: boolean,
): boolean {
  if (!requireCarrierBytesRecovery) {
    return true
  }
  if (!baseline || !current) {
    return false
  }
  return current.upload !== baseline.upload || current.download !== baseline.download
}

export function evaluateRecoveryHonesty(input: {
  record: RecoveryHonestyAttemptRecord
  nowMs: number
  currentMaxGapMs: number
  staleRequestIds: readonly string[]
  currentCarrier?: RecoveryHonestyCarrierSnapshot
}): RecoveryHonestyEvaluation {
  const elapsedMs = input.nowMs - input.record.attemptedAtMs
  const baseline = Math.max(1, input.record.baselineMaxGapMs)
  const gapReducedEnough =
    input.currentMaxGapMs <= baseline * (1 - RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO)
  const carrierRecovered = evaluateCarrierBytesRecovered(
    input.record.baselineCarrier,
    input.currentCarrier,
    input.record.requireCarrierBytesRecovery,
  )
  return {
    kind: input.record.kind,
    outcome: gapReducedEnough && carrierRecovered ? 'success' : 'ineffective',
    baselineMaxGapMs: input.record.baselineMaxGapMs,
    currentMaxGapMs: input.currentMaxGapMs,
    elapsedMs,
    staleRequestIds:
      input.staleRequestIds.length > 0 ? input.staleRequestIds : input.record.staleRequestIds,
    carrierRecovered,
    gapReducedEnough,
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
    ` gap_reduced_enough=${evaluation.gapReducedEnough ? 1 : 0}` +
    ` carrier_recovered=${evaluation.carrierRecovered ? 1 : 0}` +
    ` stale_rids=${stalePreview}\n`
  )
}
