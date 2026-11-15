// [INPUT] tunStartupGuardCore (POS: TUN 启动守卫的纯判定层：日志识别、setuid 需求、是否触发恢复) ·
//         coreReadinessGateCore (POS: Core Readiness Contract 的纯 SSOT：阶段标签、授权超时与日志间隔) ·
//         permission (POS: 内核 setuid 检查与手动授权) · 配置里的 TUN 开关、内核名与权限模式 · sysproxy
// [OUTPUT] ensureTunCorePermissionBeforeStart: 启动内核前补齐 TUN 所需权限 · watchTunStartupLogLine: 由内核日志
//          驱动恢复 · verifyTunAfterCoreReady: 内核就绪后复核 TUN · resetTunStartupGuardState / getTunStartupGuardState
// [POS] TUN 启动守卫：只有内核确实需要 setuid（TUN 开启且不走 service）而缺失时才弹授权框；TUN 监听失败时
//       有限次数地重启内核恢复，仍失败就切到系统代理兜底。

import { getAppConfig, getControledMihomoConfig, patchAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { checkCorePermissionSync, manualGrantCorePermition } from './permission'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  applyTunStartupLogLine,
  createTunStartupGuardState,
  isCoreSetuidSatisfied,
  shouldRecoverTunPermission,
  type TunStartupGuardState
} from './tunStartupGuardCore'
import {
  TUN_PERMISSION_LOG_INTERVAL_MS,
  TUN_PERMISSION_TIMEOUT_MS,
  formatCoreReadinessPhaseLog
} from './coreReadinessGateCore'

const MAX_TUN_RECOVERY_ATTEMPTS = 2
const RECOVERY_DEBOUNCE_MS = 3_000

let guardState = createTunStartupGuardState()
let recoveryTimer: NodeJS.Timeout | null = null
/**
 * 连续失败的恢复次数，直到 TUN 网卡真正监听成功才清零。
 * 恢复靠重启内核完成，而每次启动都会重置守卫状态；次数若只存在守卫状态里，
 * 每重启一次就归零，「最多恢复 2 次」就变成了错误持续时的无限重启。
 */
let consecutiveRecoveryAttempts = 0

function recoveryGateState(): TunStartupGuardState {
  return { ...guardState, recoveryAttempts: consecutiveRecoveryAttempts }
}

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

interface TunCoreContext {
  tunEnabled: boolean
  coreName: 'mihomo' | 'mihomo-alpha'
  /** 内核由 root 服务拉起（此时特权来自服务而不是 setuid）。 */
  serviceMode: boolean
  /** 当前模式下 TUN 所需的内核权限已就绪（service 模式不依赖 setuid，恒为 true）。 */
  setuidSatisfied: boolean
}

async function readTunCoreContext(): Promise<TunCoreContext> {
  const { tun } = await getControledMihomoConfig()
  const { core = 'mihomo', corePermissionMode } = await getAppConfig()
  const coreName = core === 'mihomo-alpha' ? 'mihomo-alpha' : 'mihomo'
  const tunEnabled = Boolean(tun?.enable)
  return {
    tunEnabled,
    coreName,
    serviceMode: corePermissionMode === 'service',
    setuidSatisfied: isCoreSetuidSatisfied({ tunEnabled, corePermissionMode }, () =>
      checkCorePermissionSync(coreName)
    )
  }
}

export async function ensureTunCorePermissionBeforeStart(): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  const { tunEnabled, coreName, setuidSatisfied } = await readTunCoreContext()
  if (!tunEnabled || setuidSatisfied) {
    return
  }

  await appendAppLog(
    '[TunStartupGuard]: TUN enabled but core lacks setuid — requesting permission before start\n'
  )
  await appendAppLog(formatCoreReadinessPhaseLog('tun', 'permission_required'))

  void showNotification({
    title: 'Sparkle 需要内核权限',
    body: 'TUN 模式需要授权 mihomo 内核。请在弹出的系统对话框中输入密码（窗口可能在 Sparkle 后面）。',
    variant: 'warning'
  })

  try {
    const { BrowserWindow } = await import('electron')
    const mainWindow = BrowserWindow.getAllWindows()[0]
    mainWindow?.show()
    mainWindow?.focus()
  } catch {
    // ignore when headless
  }

  const startedAt = Date.now()
  const logInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000)
    void appendAppLog(
      formatCoreReadinessPhaseLog('tun', 'awaiting_permission', `elapsed_sec=${elapsedSec}`)
    )
  }, TUN_PERMISSION_LOG_INTERVAL_MS)

  // 授权先完成时必须撤掉超时定时器，否则它会在 60 秒后对已结算的 Promise 白白触发一次。
  let permissionTimeout: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      manualGrantCorePermition([coreName]),
      new Promise<never>((_, reject) => {
        permissionTimeout = setTimeout(() => {
          reject(new Error('TUN_PERMISSION_TIMEOUT'))
        }, TUN_PERMISSION_TIMEOUT_MS)
      })
    ])
    clearInterval(logInterval)
    await appendAppLog('[TunStartupGuard]: core permission granted before start\n')
    await appendAppLog(formatCoreReadinessPhaseLog('tun', 'permission_granted'))
  } catch (error) {
    clearInterval(logInterval)
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('TUN_PERMISSION_TIMEOUT')) {
      await appendAppLog(formatCoreReadinessPhaseLog('tun', 'permission_timeout'))
      void showNotification({
        title: 'TUN 授权超时',
        body: '未在 60 秒内完成内核授权。已切换系统代理兜底，终端走 127.0.0.1:7890。',
        variant: 'danger'
      })
    }
    await appendAppLog(`[TunStartupGuard]: pre-start permission grant skipped, ${message}\n`)
    await enableSysProxyFallback()
  } finally {
    clearTimeout(permissionTimeout)
  }
}

export function watchTunStartupLogLine(logLine: string): void {
  guardState = applyTunStartupLogLine(guardState, logLine)
  if (guardState.adapterListening) {
    consecutiveRecoveryAttempts = 0
  }
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
  const { tunEnabled, coreName, setuidSatisfied, serviceMode } = await readTunCoreContext()

  if (
    !shouldRecoverTunPermission(
      tunEnabled,
      setuidSatisfied,
      recoveryGateState(),
      MAX_TUN_RECOVERY_ATTEMPTS
    )
  ) {
    return
  }

  consecutiveRecoveryAttempts += 1
  guardState = {
    ...guardState,
    recoveryInFlight: true,
    recoveryAttempts: consecutiveRecoveryAttempts
  }

  await appendAppLog(
    `[TunStartupGuard]: recovering TUN permission (source=${source}, attempt=${guardState.recoveryAttempts})\n`
  )

  try {
    if (!setuidSatisfied) {
      await manualGrantCorePermition([coreName])
      await appendAppLog('[TunStartupGuard]: permission granted — restarting core\n')
      guardState = createTunStartupGuardState()
      const { restartCore } = await import('./manager')
      await restartCore()
      return
    }

    await appendAppLog(
      '[TunStartupGuard]: core permission requirement satisfied but TUN failed — restarting core\n'
    )
    guardState = createTunStartupGuardState()
    const { restartCore } = await import('./manager')
    await restartCore()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[TunStartupGuard]: permission recovery failed, ${message}\n`)
    await enableSysProxyFallback()
    void showNotification({
      title: 'TUN 启动失败，已切换系统代理兜底',
      // service 模式下设置页没有「授予内核权限」入口，提示它只会把用户引向不存在的操作。
      body: serviceMode
        ? '终端流量将走 127.0.0.1:7890。请确认 Sparkle 服务正在运行后重启 TUN。'
        : '终端流量将走 127.0.0.1:7890。请在 Sparkle 内核设置页手动授予内核权限后重启 TUN。',
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
  const { tunEnabled, setuidSatisfied } = await readTunCoreContext()
  if (!tunEnabled || guardState.adapterListening) {
    return
  }

  if (
    shouldRecoverTunPermission(
      true,
      setuidSatisfied,
      recoveryGateState(),
      MAX_TUN_RECOVERY_ATTEMPTS
    )
  ) {
    await scheduleTunPermissionRecovery('preflight')
  }
}
