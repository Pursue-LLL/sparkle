// [INPUT] emergencyCoreRecoveryCore · proxyStackDeadlockRuntime
// [OUTPUT] requestEmergencyCoreRecovery
// [POS] C-8.14 SSOT — evidence-gated escalation *decision* + log only.
//
// BUG-2026-09-15-004: the disruptive core stop+start was removed. A full mihomo
// restart drops every proxied connection of every app, and during lossy upstream
// periods it recurred every few minutes — turning a Cursor-only stall into a
// collective outage. Escalation is now recorded for triage but never stops the
// core; stalls are handled by non-disruptive recovery (vitality / sidecar / leaf).

import { appendAppLog } from '../utils/log'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
  formatEmergencyCoreRecoveryLogLine,
  type EmergencyCoreRecoveryReason,
} from './emergencyCoreRecoveryCore'
import type { LongflowEvidence } from './proxyStackDeadlockCore'

/** Terminal outcome of an escalation request: recorded, never disruptive. */
export const EMERGENCY_CORE_RESTART_REMOVED = 'emergency_core_restart_removed'

export interface EmergencyCoreRecoveryInput {
  reason: EmergencyCoreRecoveryReason
  leafId: string
  evidenceReason: string
  cursorConnectionCount: number
  nowMs?: number
  /**
   * Collective long-flow death proof — lets the deadlock gate override the
   * mixed-port veto. Required by contract: pass `unknownLongflowEvidence(...)`
   * when the caller genuinely has no measurement, never omit or zero-fill.
   */
  longflow: LongflowEvidence
}

let emergencyRecoveryInFlight = false

export function resetEmergencyCoreRecoveryForTests(): void {
  emergencyRecoveryInFlight = false
}

export async function requestEmergencyCoreRecovery(
  input: EmergencyCoreRecoveryInput,
): Promise<{ executed: boolean; reason: string }> {
  const nowMs = input.nowMs ?? Date.now()
  if (emergencyRecoveryInFlight) {
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'blocked',
        reason: 'emergency_recovery_in_flight',
        leafId: input.leafId,
        cursorConn: input.cursorConnectionCount,
      }),
    )
    return { executed: false, reason: 'emergency_recovery_in_flight' }
  }
  emergencyRecoveryInFlight = true
  try {
    const request = {
      reason: input.reason,
      leafId: input.leafId,
      evidenceReason: input.evidenceReason,
      cursorConnectionCount: input.cursorConnectionCount,
      requestedAtMs: nowMs,
      deadlineMs: buildEmergencyCoreRecoveryDeadline(nowMs),
    }
    const { confirmProxyStackDeadlockForCoreRestart } = await import('./proxyStackDeadlockRuntime')
    const stackVerdict = await confirmProxyStackDeadlockForCoreRestart(input.longflow)
    const admission = evaluateEmergencyCoreRecoveryAdmission({
      request,
      nowMs,
      lastCompletedAtMs: 0,
      stackDeadlockConfirmed: stackVerdict.confirmed,
    })
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'blocked',
        reason: admission.admitted
          ? EMERGENCY_CORE_RESTART_REMOVED
          : admission.reason === 'proxy_stack_not_confirmed_deadlock'
            ? stackVerdict.reason
            : admission.reason,
        leafId: input.leafId,
        cursorConn: input.cursorConnectionCount,
      }),
    )
    return { executed: false, reason: EMERGENCY_CORE_RESTART_REMOVED }
  } finally {
    emergencyRecoveryInFlight = false
  }
}
