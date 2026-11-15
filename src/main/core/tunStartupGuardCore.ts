// [INPUT] 内核日志行 · TUN 开关与内核权限模式（`elevated` / `service`）· 守卫状态
// [OUTPUT] isTunAdapterListeningLog / isTunPermissionError / isTunCachePermissionError: 日志识别 ·
//          applyTunStartupLogLine / createTunStartupGuardState: 守卫状态的推进 ·
//          requiresCoreSetuid: TUN 是否必须依赖内核自带 setuid · isCoreSetuidSatisfied ·
//          shouldRecoverTunPermission: 是否触发一次恢复 ·
//          TunStartupGuardState · CorePermissionMode · CoreSetuidRequirementInput
// [POS] TUN 启动守卫的纯判定层（无 I/O）；setuid 需求的口径与 scripts/lib/core-setuid.sh 一致，
//       由 coreSetuidScriptParity.test.ts 逐格对齐。

export function isTunAdapterListeningLog(logLine: string): boolean {
  return logLine.includes('[TUN] Tun adapter listening at:')
}

export function isTunPermissionError(logLine: string): boolean {
  return logLine.includes(
    'Start TUN listening error: configure tun interface: operation not permitted'
  )
}

export function isTunCachePermissionError(logLine: string): boolean {
  return logLine.includes("can't open cache file") && logLine.includes('permission denied')
}

export interface TunStartupGuardState {
  adapterListening: boolean
  permissionErrorSeen: boolean
  recoveryAttempts: number
  recoveryInFlight: boolean
}

export function createTunStartupGuardState(): TunStartupGuardState {
  return {
    adapterListening: false,
    permissionErrorSeen: false,
    recoveryAttempts: 0,
    recoveryInFlight: false
  }
}

export function applyTunStartupLogLine(
  state: TunStartupGuardState,
  logLine: string
): TunStartupGuardState {
  const next = { ...state }
  if (isTunAdapterListeningLog(logLine)) {
    next.adapterListening = true
    next.permissionErrorSeen = false
  }
  if (isTunPermissionError(logLine) || isTunCachePermissionError(logLine)) {
    next.permissionErrorSeen = true
    next.adapterListening = false
  }
  return next
}

/** 内核获得特权的方式：`elevated` 靠自带 setuid 自提权；`service` 由 root 服务拉起。 */
export type CorePermissionMode = 'elevated' | 'service'

export interface CoreSetuidRequirementInput {
  tunEnabled: boolean
  /** 未配置时 App 的默认值是 `elevated`。 */
  corePermissionMode: CorePermissionMode | undefined
}

/**
 * TUN 是否必须依赖内核自带 setuid。
 * service 模式下内核是 root 服务的子进程，创建 TUN 网卡不需要 setuid；此时仍要求它，
 * 只会让每次升级（安装会丢失内核的属主与权限位）后启动都弹一次没有意义的系统密码框。
 */
export function requiresCoreSetuid(input: CoreSetuidRequirementInput): boolean {
  return input.tunEnabled && input.corePermissionMode !== 'service'
}

/**
 * setuid 需求已满足：要么不需要，要么确实具备。
 * `hasCoreSetuid` 惰性求值，不需要 setuid 时不做多余的文件系统访问。
 */
export function isCoreSetuidSatisfied(
  input: CoreSetuidRequirementInput,
  hasCoreSetuid: () => boolean
): boolean {
  return !requiresCoreSetuid(input) || hasCoreSetuid()
}

export function shouldRecoverTunPermission(
  tunEnabled: boolean,
  setuidSatisfied: boolean,
  state: TunStartupGuardState,
  maxAttempts: number
): boolean {
  if (!tunEnabled) {
    return false
  }
  if (state.recoveryInFlight) {
    return false
  }
  if (state.recoveryAttempts >= maxAttempts) {
    return false
  }
  if (state.adapterListening) {
    return false
  }
  return state.permissionErrorSeen || !setuidSatisfied
}
