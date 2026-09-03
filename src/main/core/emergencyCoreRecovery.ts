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

async function verifyEmergencyDataPlaneReady(maxWaitMs: number): Promise<{
  controllerReady: boolean
  api2Ok: boolean
  api2Leaf?: string
  probeVia?: string
}> {
  const startedAtMs = Date.now()
  const deadlineMs = startedAtMs + maxWaitMs
  let controllerReady = false
  let api2Ok = false
  let api2Leaf: string | undefined
  let probeVia: string | undefined
  while (Date.now() < deadlineMs) {
    if (!controllerReady) {
      const { waitForMihomoControllerReady } = await import('./postCoreBootstrap')
      controllerReady = await waitForMihomoControllerReady(
        Math.min(8_000, Math.max(1_000, deadlineMs - Date.now())),
      )
    }
    if (!api2Ok) {
      const { probeRecoveryApi2AnchorDetailed } = await import('./recoveryApi2Anchor')
      const probe = await probeRecoveryApi2AnchorDetailed(
        Math.min(10_000, Math.max(3_000, deadlineMs - Date.now())),
      )
      api2Ok = probe.ok
      api2Leaf = probe.leaf
      probeVia = probe.probeVia
    }
    if (api2Ok) {
      return { controllerReady, api2Ok: true, api2Leaf, probeVia }
    }
    await delay(3_000)
  }
  return { controllerReady, api2Ok: false, api2Leaf, probeVia }
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
  const shouldShowCollectiveDeathToast =
    input.cursorConnectionCount > 0 || admission.drainMs > 0
  try {
    if (shouldShowCollectiveDeathToast) {
      const { notifyCollectiveDeathAlert } = await import('./collectiveDeathAlert')
      void notifyCollectiveDeathAlert({
        trigger: 'emergency_core_recovery',
        title: '网络集体恢复中',
        body: `代理核心正在紧急重建（约 ${Math.round(admission.drainMs / 1000)} 秒）。可点击「复制 Bug 信息」粘贴给 AI 分析。`,
        cursorConnectionCount: input.cursorConnectionCount,
        leafId: input.leafId,
        evidenceReason: input.evidenceReason,
        drainMs: admission.drainMs,
        tsMs: nowMs,
      })
    }
  } catch {
    // alert is best-effort; emergency recovery must proceed
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
          err:
            `controller=${readiness.controllerReady ? 1 : 0} api2=${readiness.api2Ok ? 1 : 0}` +
            ` probe_via=${readiness.probeVia ?? 'unknown'} leaf=${readiness.api2Leaf ?? 'unknown'}`,
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
      `[EmergencyCoreRecovery]: readiness controller=${readiness.controllerReady ? 1 : 0} api2=${readiness.api2Ok ? 1 : 0} probe_via=${readiness.probeVia ?? 'unknown'} leaf=${readiness.api2Leaf ?? 'unknown'}\n`,
    )
    try {
      const { dismissCollectiveDeathAlert } = await import('./collectiveDeathAlert')
      dismissCollectiveDeathAlert()
    } catch {
      // best-effort dismiss
    }
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
