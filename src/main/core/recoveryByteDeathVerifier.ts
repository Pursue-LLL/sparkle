// [INPUT] recoveryByteDeathVerifierCore · mihomoApi · api2ProbeLedger · recoveryCircuitBreaker
// [OUTPUT] recordByteDeathRecoveryAttempt · evaluatePendingByteDeathRecoveryIfDue
// [POS] Phase-1 runtime — gate circuit clear on verified byte-death recovery.

import { appendAppLog } from '../utils/log'
import { readApi2ProbeLedgerSince } from './api2ProbeLedgerCore'
import {
  evaluateByteDeathRecoveryHonesty,
  formatByteDeathRecoveryHonestyLogLine,
  shouldEvaluateByteDeathRecoveryHonesty,
  type ByteDeathRecoveryAttemptRecord,
} from './recoveryByteDeathVerifierCore'
import {
  notifyRecoveryCircuitFailure,
  notifyRecoveryCircuitSuccess,
} from './recoveryCircuitBreaker'

let pendingByteDeathRecovery: ByteDeathRecoveryAttemptRecord | undefined

export function resetByteDeathRecoveryVerifierForTests(): void {
  pendingByteDeathRecovery = undefined
}

export function getPendingByteDeathRecoveryForTests(): ByteDeathRecoveryAttemptRecord | undefined {
  return pendingByteDeathRecovery ? { ...pendingByteDeathRecovery } : undefined
}

export function recordByteDeathRecoveryAttempt(
  record: ByteDeathRecoveryAttemptRecord,
): void {
  pendingByteDeathRecovery = record
}

export async function scheduleByteDeathRecoveryVerification(input: {
  leafId: string
  nowMs: number
  udpParentClosed: boolean
  maxByteStallMs: number
  baselineCarrier?: { upload: number; download: number }
  connectionId?: string
  anchorProbeOk?: boolean
}): Promise<void> {
  if (!input.udpParentClosed) {
    await notifyRecoveryCircuitFailure({
      nowMs: input.nowMs,
      reason: 'byte_death_probe_only_without_udp_close',
    })
    return
  }
  recordByteDeathRecoveryAttempt({
    leafId: input.leafId,
    attemptedAtMs: input.nowMs,
    udpParentClosed: true,
    baselineMaxByteStallMs: input.maxByteStallMs,
    baselineCarrier: input.baselineCarrier,
    connectionId: input.connectionId,
    anchorProbeOk: input.anchorProbeOk,
  })
  await appendAppLog(
    `[ByteDeathRecoveryHonesty]: outcome=planned reason=byte_death_verification_scheduled leaf=${input.leafId} stall_ms=${input.maxByteStallMs}\n`,
  )
}

async function resolveRecentApi2ProbeOk(
  nowMs: number,
  record?: ByteDeathRecoveryAttemptRecord,
): Promise<boolean> {
  if (record?.anchorProbeOk === true) {
    return true
  }
  const rows = await readApi2ProbeLedgerSince(nowMs - 90_000, 'active')
  return rows.some((row) => row.ok === true)
}

export async function evaluatePendingByteDeathRecoveryIfDue(
  input: {
    nowMs?: number
    currentMaxByteStallMs: number
    currentCarrier?: { upload: number; download: number }
  },
): Promise<{ evaluated: boolean; outcome?: 'success' | 'ineffective' }> {
  const nowMs = input.nowMs ?? Date.now()
  if (!shouldEvaluateByteDeathRecoveryHonesty(pendingByteDeathRecovery, nowMs)) {
    return { evaluated: false }
  }
  const record = pendingByteDeathRecovery!
  const api2ProbeOk = await resolveRecentApi2ProbeOk(nowMs, record)
  const evaluation = evaluateByteDeathRecoveryHonesty({
    record,
    nowMs,
    currentMaxByteStallMs: input.currentMaxByteStallMs,
    currentCarrier: input.currentCarrier,
    api2ProbeOk,
  })
  await appendAppLog(formatByteDeathRecoveryHonestyLogLine(evaluation))
  pendingByteDeathRecovery = undefined

  if (evaluation.outcome === 'success') {
    await notifyRecoveryCircuitSuccess()
    const { submitRecoveryCoordinatorEvent } = await import('./recoveryCoordinator')
    await submitRecoveryCoordinatorEvent({
      event: {
        type: 'VERIFICATION_PASSED',
        leafId: record.leafId,
        generation: 0,
        observedAt: nowMs,
        detail: evaluation.reason,
      },
      connections: [],
      cursorConnectionCount: 0,
      nowMs,
    })
    return { evaluated: true, outcome: 'success' }
  }

  await notifyRecoveryCircuitFailure({
    nowMs,
    reason: evaluation.reason,
  })
  return { evaluated: true, outcome: 'ineffective' }
}
