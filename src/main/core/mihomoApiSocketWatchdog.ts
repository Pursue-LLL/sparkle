// [INPUT] mihomoIpcPath · coreReadyTimestamp · mihomoApi.getAxios · marathonCoreRestartGuard
// [OUTPUT] ensureMihomoApiReachableForMarathon
// [POS] Restore mihomo REST unix socket when ECONNREFUSED breaks marathon nudge chain.

import { existsSync } from 'fs'
import { appendAppLog } from '../utils/log'
import { mihomoIpcPath } from '../utils/dirs'
import { safeGetLastCoreReadyAtMs } from './coreReadyTimestamp'
import { isCoreWithinStartupGrace } from './networkStartupGraceCore'

const MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS = 60_000

let lastMihomoSocketRecoveryAtMs = 0
let deferredMihomoSocketRecoveryTimer: NodeJS.Timeout | null = null
let deferredMihomoSocketRecoveryReason = ''

export function isMihomoApiSocketPresent(): boolean {
  if (process.platform === 'win32') {
    return true
  }
  return existsSync(mihomoIpcPath())
}

function isMihomoApiConnectionError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('econnrefused') ||
    normalized.includes('connect enotconn') ||
    normalized.includes('socket hang up')
  )
}

function clearDeferredMihomoSocketRecoveryTimer(): void {
  if (deferredMihomoSocketRecoveryTimer) {
    clearTimeout(deferredMihomoSocketRecoveryTimer)
    deferredMihomoSocketRecoveryTimer = null
  }
  deferredMihomoSocketRecoveryReason = ''
}

function scheduleDeferredMihomoSocketRecovery(reason: string, delayMs: number): void {
  if (deferredMihomoSocketRecoveryTimer) {
    return
  }
  deferredMihomoSocketRecoveryReason = reason
  deferredMihomoSocketRecoveryTimer = setTimeout(() => {
    deferredMihomoSocketRecoveryTimer = null
    const retryReason = deferredMihomoSocketRecoveryReason
    deferredMihomoSocketRecoveryReason = ''
    void ensureMihomoApiReachableForMarathon(`${retryReason}_retry`)
  }, delayMs)
}

export async function ensureMihomoApiReachableForMarathon(reason: string): Promise<boolean> {
  const nowMs = Date.now()
  if (nowMs - lastMihomoSocketRecoveryAtMs < MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS) {
    return false
  }

  if (isCoreWithinStartupGrace(safeGetLastCoreReadyAtMs(), undefined, nowMs)) {
    return false
  }

  if (isMihomoApiSocketPresent()) {
    try {
      const { mihomoVersion } = await import('./mihomoApi')
      await mihomoVersion()
      clearDeferredMihomoSocketRecoveryTimer()
      return false
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (!isMihomoApiConnectionError(errMsg)) {
        return false
      }
    }
  }

  lastMihomoSocketRecoveryAtMs = nowMs
  await appendAppLog(`[MihomoApiSocketWatchdog]: recover reason=${reason}\n`)
  const { evaluateMarathonCoreColdRestart } = await import('./marathonCoreRestartGuard')
  const guard = await evaluateMarathonCoreColdRestart('restartCore')
  if (guard.blocked) {
    await appendAppLog(
      `[MihomoApiSocketWatchdog]: defer restartCore cursor_conn=${guard.snapshot.cursorConnectionCount} quiesce=${guard.snapshot.quiesceActive ? '1' : '0'} retry_ms=${MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS}\n`,
    )
    scheduleDeferredMihomoSocketRecovery(reason, MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS)
    return false
  }
  clearDeferredMihomoSocketRecoveryTimer()
  const { getAxios } = await import('./mihomoApi')
  await getAxios(true)
  const { restartCore } = await import('./manager')
  await restartCore()
  return true
}

export async function recoverMihomoApiAfterNudgeFailure(error: unknown): Promise<void> {
  const errMsg = error instanceof Error ? error.message : String(error)
  if (!isMihomoApiConnectionError(errMsg)) {
    return
  }
  if (!errMsg.includes('sparkle-mihomo') && isMihomoApiSocketPresent()) {
    await ensureMihomoApiReachableForMarathon('nudge_api_error')
    return
  }
  await ensureMihomoApiReachableForMarathon('nudge_econnrefused')
}

export function resetMihomoApiSocketWatchdogForTests(): void {
  lastMihomoSocketRecoveryAtMs = 0
  clearDeferredMihomoSocketRecoveryTimer()
}
