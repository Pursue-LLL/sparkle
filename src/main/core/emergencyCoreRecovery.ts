// [INPUT] emergencyCoreRecoveryCore · manager · marathonCoreRestartGuard
// [OUTPUT] requestEmergencyCoreRecovery
// [POS] C-8.14 runtime — evidence-gated emergency core rebuild.

import { appendAppLog } from '../utils/log'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
  formatEmergencyCoreRecoveryLogLine,
  type EmergencyCoreRecoveryReason,
} from './emergencyCoreRecoveryCore'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export interface EmergencyCoreRecoveryInput {
  reason: EmergencyCoreRecoveryReason
  leafId: string
  evidenceReason: string
  cursorConnectionCount: number
  nowMs?: number
}

export async function requestEmergencyCoreRecovery(
  input: EmergencyCoreRecoveryInput,
): Promise<{ executed: boolean; reason: string }> {
  const nowMs = input.nowMs ?? Date.now()
  const request = {
    reason: input.reason,
    leafId: input.leafId,
    evidenceReason: input.evidenceReason,
    cursorConnectionCount: input.cursorConnectionCount,
    requestedAtMs: nowMs,
    deadlineMs: buildEmergencyCoreRecoveryDeadline(nowMs),
  }
  const admission = evaluateEmergencyCoreRecoveryAdmission({ request, nowMs })
  await appendAppLog(
    formatEmergencyCoreRecoveryLogLine({
      outcome: admission.admitted ? 'admitted' : 'blocked',
      reason: admission.reason,
      leafId: input.leafId,
      cursorConn: input.cursorConnectionCount,
      drainMs: admission.drainMs,
    }),
  )
  if (!admission.admitted) {
    return { executed: false, reason: admission.reason }
  }
  if (admission.drainMs > 0) {
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'planned',
        reason: 'emergency_drain_before_restart',
        leafId: input.leafId,
        cursorConn: input.cursorConnectionCount,
        drainMs: admission.drainMs,
      }),
    )
    await delay(admission.drainMs)
  }
  try {
    const { restartCoreEmergency } = await import('./manager')
    await restartCoreEmergency({
      leafId: input.leafId,
      evidenceReason: input.evidenceReason,
      requestedAtMs: nowMs,
      deadlineMs: request.deadlineMs,
    })
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'executed',
        reason: 'emergency_core_recovery_completed',
        leafId: input.leafId,
        cursorConn: input.cursorConnectionCount,
      }),
    )
    return { executed: true, reason: 'emergency_core_recovery_completed' }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error)
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'failed',
        reason: 'emergency_core_recovery_failed',
        leafId: input.leafId,
        err,
      }),
    )
    return { executed: false, reason: err }
  }
}
