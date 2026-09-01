// [INPUT] recoveryHonestyCore · byte-death attempt snapshots
// [OUTPUT] evaluateByteDeathRecoveryHonesty · formatByteDeathRecoveryHonestyLogLine
// [POS] Phase-1 SSOT — byte-death recovery success requires carrier bytes + api2 evidence.

import {
  evaluateCarrierBytesRecovered,
  evaluateRecoveryHonesty,
  RECOVERY_HONESTY_EVAL_WINDOW_MS,
  type RecoveryHonestyCarrierSnapshot,
} from './recoveryHonestyCore'

export const BYTE_DEATH_RECOVERY_MIN_EVAL_MS = 5_000

export interface ByteDeathRecoveryAttemptRecord {
  leafId: string
  attemptedAtMs: number
  udpParentClosed: boolean
  baselineMaxByteStallMs: number
  baselineCarrier?: RecoveryHonestyCarrierSnapshot
  connectionId?: string
}

export interface ByteDeathRecoveryHonestyEvaluation {
  outcome: 'success' | 'ineffective'
  reason: string
  leafId: string
  elapsedMs: number
  udpParentClosed: boolean
  carrierRecovered: boolean
  api2ProbeOk: boolean
  gapReducedEnough: boolean
}

export function shouldEvaluateByteDeathRecoveryHonesty(
  record: ByteDeathRecoveryAttemptRecord | undefined,
  nowMs: number,
): boolean {
  if (!record) {
    return false
  }
  const elapsedMs = nowMs - record.attemptedAtMs
  return elapsedMs >= BYTE_DEATH_RECOVERY_MIN_EVAL_MS &&
    elapsedMs <= RECOVERY_HONESTY_EVAL_WINDOW_MS + BYTE_DEATH_RECOVERY_MIN_EVAL_MS
}

export function evaluateByteDeathRecoveryHonesty(input: {
  record: ByteDeathRecoveryAttemptRecord
  nowMs: number
  currentMaxByteStallMs: number
  currentCarrier?: RecoveryHonestyCarrierSnapshot
  api2ProbeOk: boolean
}): ByteDeathRecoveryHonestyEvaluation {
  const elapsedMs = input.nowMs - input.record.attemptedAtMs
  const { record } = input

  if (!record.udpParentClosed) {
    return {
      outcome: 'ineffective',
      reason: 'byte_death_probe_only_without_udp_close',
      leafId: record.leafId,
      elapsedMs,
      udpParentClosed: false,
      carrierRecovered: false,
      api2ProbeOk: input.api2ProbeOk,
      gapReducedEnough: false,
    }
  }

  const honesty = evaluateRecoveryHonesty({
    record: {
      kind: 'hy2_parent_rotation',
      attemptedAtMs: record.attemptedAtMs,
      baselineMaxGapMs: Math.max(1, record.baselineMaxByteStallMs),
      staleRequestIds: [],
      baselineCarrier: record.baselineCarrier,
      requireCarrierBytesRecovery: true,
      connectionId: record.connectionId,
    },
    nowMs: input.nowMs,
    currentMaxGapMs: input.currentMaxByteStallMs,
    staleRequestIds: [],
    currentCarrier: input.currentCarrier,
  })

  const carrierRecovered = evaluateCarrierBytesRecovered(
    record.baselineCarrier,
    input.currentCarrier,
    true,
  )

  if (!input.api2ProbeOk) {
    return {
      outcome: 'ineffective',
      reason: 'byte_death_api2_probe_failed',
      leafId: record.leafId,
      elapsedMs,
      udpParentClosed: true,
      carrierRecovered,
      api2ProbeOk: false,
      gapReducedEnough: honesty.gapReducedEnough,
    }
  }

  const verified = honesty.gapReducedEnough && carrierRecovered
  return {
    outcome: verified ? 'success' : 'ineffective',
    reason: verified ? 'byte_death_verified_recovered' : 'byte_death_honesty_ineffective',
    leafId: record.leafId,
    elapsedMs,
    udpParentClosed: true,
    carrierRecovered,
    api2ProbeOk: true,
    gapReducedEnough: honesty.gapReducedEnough,
  }
}

export function formatByteDeathRecoveryHonestyLogLine(
  evaluation: ByteDeathRecoveryHonestyEvaluation,
): string {
  return (
    `[ByteDeathRecoveryHonesty]:` +
    ` outcome=${evaluation.outcome}` +
    ` reason=${evaluation.reason}` +
    ` leaf=${evaluation.leafId}` +
    ` elapsed_ms=${evaluation.elapsedMs}` +
    ` udp_closed=${evaluation.udpParentClosed ? 1 : 0}` +
    ` carrier_recovered=${evaluation.carrierRecovered ? 1 : 0}` +
    ` api2_ok=${evaluation.api2ProbeOk ? 1 : 0}` +
    ` gap_reduced=${evaluation.gapReducedEnough ? 1 : 0}\n`
  )
}
