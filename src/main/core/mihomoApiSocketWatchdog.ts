// [INPUT] mihomoIpcPath · manager.getLastCoreReadyAtMs · mihomoApi.getAxios
// [OUTPUT] ensureMihomoApiReachableForMarathon
// [POS] Restore mihomo REST unix socket when ECONNREFUSED breaks marathon nudge chain.

import { existsSync } from 'fs'
import { appendAppLog } from '../utils/log'
import { mihomoIpcPath } from '../utils/dirs'
import { isCoreWithinStartupGrace } from './networkStartupGraceCore'

const MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS = 60_000

let lastMihomoSocketRecoveryAtMs = 0

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

export async function ensureMihomoApiReachableForMarathon(reason: string): Promise<boolean> {
  const nowMs = Date.now()
  if (nowMs - lastMihomoSocketRecoveryAtMs < MIHOMO_SOCKET_RECOVERY_COOLDOWN_MS) {
    return false
  }

  const { getLastCoreReadyAtMs } = await import('./manager')
  if (isCoreWithinStartupGrace(getLastCoreReadyAtMs(), undefined, nowMs)) {
    return false
  }

  if (isMihomoApiSocketPresent()) {
    try {
      const { mihomoVersion } = await import('./mihomoApi')
      await mihomoVersion()
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
}
