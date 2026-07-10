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

export function shouldRecoverTunPermission(
  tunEnabled: boolean,
  hasCoreSetuid: boolean,
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
  return state.permissionErrorSeen || !hasCoreSetuid
}
