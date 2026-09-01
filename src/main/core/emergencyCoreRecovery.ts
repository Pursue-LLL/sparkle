// [INPUT] emergencyCoreRecoveryCore · emergencyCoreRestartBridge · coreReadinessGate
// [OUTPUT] requestEmergencyCoreRecovery
// [POS] C-8.14 runtime — evidence-gated emergency core rebuild.

import { appendAppLog } from '../utils/log'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
  formatEmergencyCoreRecoveryLogLine,
  type EmergencyCoreRecoveryReason,
} from './emergencyCoreRecoveryCore'
import { invokeEmergencyCoreRestart } from './emergencyCoreRestartBridge'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function probeApi2ViaProxy(): Promise<boolean> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    await execFileAsync('curl', [
      '-sf',
      '--max-time',
      '10',
      '-x',
      'http://127.0.0.1:7890',
      'https://api2.cursor.sh/',
    ])
    return true
  } catch {
    return false
  }
}

async function verifyEmergencyDataPlaneReady(maxWaitMs: number): Promise<{
  controllerReady: boolean
  api2Ok: boolean
}> {
  const startedAtMs = Date.now()
  const deadlineMs = startedAtMs + maxWaitMs
  let controllerReady = false
  let api2Ok = false
  while (Date.now() < deadlineMs) {
    if (!controllerReady) {
      const { waitForMihomoControllerReady } = await import('./postCoreBootstrap')
      controllerReady = await waitForMihomoControllerReady(
        Math.min(8_000, Math.max(1_000, deadlineMs - Date.now())),
      )
    }
    if (!api2Ok) {
      api2Ok = await probeApi2ViaProxy()
    }
    if (api2Ok) {
      return { controllerReady, api2Ok: true }
    }
    await delay(3_000)
  }
  return { controllerReady, api2Ok: false }
}

export interface EmergencyCoreRecoveryInput {
  reason: EmergencyCoreRecoveryReason
  leafId: string
  evidenceReason: string
  cursorConnectionCount: number
  nowMs?: number
}

let emergencyRecoveryInFlight = false
let lastEmergencyCompletedAtMs = 0

export function resetEmergencyCoreRecoveryForTests(nowMs = Date.now()): void {
  emergencyRecoveryInFlight = false
  lastEmergencyCompletedAtMs = nowMs - 999_999_999
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
  const request = {
    reason: input.reason,
    leafId: input.leafId,
    evidenceReason: input.evidenceReason,
    cursorConnectionCount: input.cursorConnectionCount,
    requestedAtMs: nowMs,
    deadlineMs: buildEmergencyCoreRecoveryDeadline(nowMs),
  }
  const admission = evaluateEmergencyCoreRecoveryAdmission({
    request,
    nowMs,
    lastCompletedAtMs: lastEmergencyCompletedAtMs,
  })
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
    emergencyRecoveryInFlight = false
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
    await invokeEmergencyCoreRestart({
      leafId: input.leafId,
      evidenceReason: input.evidenceReason,
      requestedAtMs: nowMs,
      deadlineMs: request.deadlineMs,
    })
    const readiness = await verifyEmergencyDataPlaneReady(90_000)
    if (!readiness.api2Ok) {
      await appendAppLog(
        formatEmergencyCoreRecoveryLogLine({
          outcome: 'failed',
          reason: 'emergency_readiness_verification_failed',
          leafId: input.leafId,
          err: `controller=${readiness.controllerReady ? 1 : 0} api2=${readiness.api2Ok ? 1 : 0}`,
        }),
      )
      return { executed: false, reason: 'emergency_readiness_verification_failed' }
    }
    await appendAppLog(
      formatEmergencyCoreRecoveryLogLine({
        outcome: 'executed',
        reason: 'emergency_core_recovery_completed',
        leafId: input.leafId,
        cursorConn: input.cursorConnectionCount,
        drainMs: readiness.controllerReady ? 0 : -1,
      }),
    )
    await appendAppLog(
      `[EmergencyCoreRecovery]: readiness controller=${readiness.controllerReady ? 1 : 0} api2=${readiness.api2Ok ? 1 : 0}\n`,
    )
    lastEmergencyCompletedAtMs = Date.now()
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
  } finally {
    emergencyRecoveryInFlight = false
  }
}
