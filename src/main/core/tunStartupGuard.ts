import { getAppConfig, getControledMihomoConfig, patchAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { checkCorePermissionSync, manualGrantCorePermition } from './permission'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  applyTunStartupLogLine,
  createTunStartupGuardState,
  shouldRecoverTunPermission,
  type TunStartupGuardState
} from './tunStartupGuardCore'

const MAX_TUN_RECOVERY_ATTEMPTS = 2
const RECOVERY_DEBOUNCE_MS = 3_000

let guardState = createTunStartupGuardState()
let recoveryTimer: NodeJS.Timeout | null = null

export function resetTunStartupGuardState(): void {
  guardState = createTunStartupGuardState()
  if (recoveryTimer) {
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
}

export function getTunStartupGuardState(): TunStartupGuardState {
  return guardState
}

export async function ensureTunCorePermissionBeforeStart(): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  const { tun } = await getControledMihomoConfig()
  if (!tun?.enable) {
    return
  }

  const { core = 'mihomo' } = await getAppConfig()
  const coreName = core === 'mihomo-alpha' ? 'mihomo-alpha' : 'mihomo'
  if (checkCorePermissionSync(coreName)) {
    return
  }

  await appendAppLog(
    '[TunStartupGuard]: TUN enabled but core lacks setuid — requesting permission before start\n'
  )

  try {
    await manualGrantCorePermition([coreName])
    await appendAppLog('[TunStartupGuard]: core permission granted before start\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[TunStartupGuard]: pre-start permission grant skipped, ${message}\n`)
  }
}

export function watchTunStartupLogLine(logLine: string): void {
  guardState = applyTunStartupLogLine(guardState, logLine)
  if (!guardState.permissionErrorSeen) {
    return
  }
  if (recoveryTimer) {
    return
  }
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void scheduleTunPermissionRecovery('log')
  }, RECOVERY_DEBOUNCE_MS)
}

async function scheduleTunPermissionRecovery(source: 'log' | 'preflight'): Promise<void> {
  const { tun } = await getControledMihomoConfig()
  const { core = 'mihomo' } = await getAppConfig()
  const coreName = core === 'mihomo-alpha' ? 'mihomo-alpha' : 'mihomo'
  const hasSetuid = checkCorePermissionSync(coreName)

  if (
    !shouldRecoverTunPermission(
      tun?.enable === true,
      hasSetuid,
      guardState,
      MAX_TUN_RECOVERY_ATTEMPTS
    )
  ) {
    return
  }

  guardState = {
    ...guardState,
    recoveryInFlight: true,
    recoveryAttempts: guardState.recoveryAttempts + 1
  }

  await appendAppLog(
    `[TunStartupGuard]: recovering TUN permission (source=${source}, attempt=${guardState.recoveryAttempts})\n`
  )

  try {
    if (!hasSetuid) {
      await manualGrantCorePermition([coreName])
      await appendAppLog('[TunStartupGuard]: permission granted — restarting core\n')
      guardState = createTunStartupGuardState()
      const { restartCore } = await import('./manager')
      await restartCore()
      return
    }

    await appendAppLog('[TunStartupGuard]: setuid present but TUN failed — restarting core\n')
    guardState = createTunStartupGuardState()
    const { restartCore } = await import('./manager')
    await restartCore()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[TunStartupGuard]: permission recovery failed, ${message}\n`)
    await enableSysProxyFallback()
    void showNotification({
      title: 'TUN 启动失败，已切换系统代理兜底',
      body: '终端流量将走 127.0.0.1:7890。请在 Sparkle 内核设置页手动授予内核权限后重启 TUN。',
      variant: 'warning'
    })
  } finally {
    guardState = { ...guardState, recoveryInFlight: false }
  }
}

async function enableSysProxyFallback(): Promise<void> {
  const appConfig = await getAppConfig()
  if (appConfig.sysProxy?.enable) {
    return
  }
  await patchAppConfig({
    sysProxy: {
      ...appConfig.sysProxy,
      enable: true
    }
  })
  const { onlyActiveDevice = false } = appConfig
  await triggerSysProxy(true, onlyActiveDevice)
  await appendAppLog('[TunStartupGuard]: enabled system proxy fallback for terminal traffic\n')
}

export async function verifyTunAfterCoreReady(): Promise<void> {
  const { tun } = await getControledMihomoConfig()
  if (!tun?.enable) {
    return
  }

  const { core = 'mihomo' } = await getAppConfig()
  const coreName = core === 'mihomo-alpha' ? 'mihomo-alpha' : 'mihomo'
  const hasSetuid = checkCorePermissionSync(coreName)

  if (guardState.adapterListening) {
    return
  }

  if (
    shouldRecoverTunPermission(
      true,
      hasSetuid,
      guardState,
      MAX_TUN_RECOVERY_ATTEMPTS
    )
  ) {
    await scheduleTunPermissionRecovery('preflight')
  }
}
