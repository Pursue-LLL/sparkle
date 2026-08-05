// [INPUT] socket existence + HTTP probe error
// [OUTPUT] stale mihomo unix socket detection for core footprint resolution
// [POS] SSOT: zombie socket must not block start-only core launch after marathon guard skip

export interface StaleMihomoApiSocketInput {
  exists: boolean
  probeError: string | null
}

export function isStaleMihomoApiSocketProbeError(probeError: string): boolean {
  const normalized = probeError.toLowerCase()
  return (
    normalized.includes('econnrefused') ||
    normalized.includes('enotconn') ||
    normalized.includes('socket hang up')
  )
}

export function shouldRemoveStaleMihomoApiSocket(input: StaleMihomoApiSocketInput): boolean {
  if (!input.exists) {
    return false
  }
  if (!input.probeError) {
    return false
  }
  return isStaleMihomoApiSocketProbeError(input.probeError)
}

export type CoreStartFootprintDecision =
  | { blockStart: true; reason: 'protected_existing_core' | 'stale_socket_remove_failed' }
  | { blockStart: false; reason: 'no_existing_core_footprint' | 'stale_socket_removed_start_only' }

export function resolveCoreStartFootprintDecision(input: {
  hasChildProcess: boolean
  corePidExists: boolean
  socketExists: boolean
  probeError: string | null
  staleSocketRemoved: boolean
}): CoreStartFootprintDecision {
  if (input.hasChildProcess || input.corePidExists) {
    return { blockStart: true, reason: 'protected_existing_core' }
  }
  if (!input.socketExists) {
    return { blockStart: false, reason: 'no_existing_core_footprint' }
  }
  if (!input.probeError) {
    return { blockStart: true, reason: 'protected_existing_core' }
  }
  if (!shouldRemoveStaleMihomoApiSocket({ exists: true, probeError: input.probeError })) {
    return { blockStart: true, reason: 'protected_existing_core' }
  }
  if (input.staleSocketRemoved) {
    return { blockStart: false, reason: 'stale_socket_removed_start_only' }
  }
  return { blockStart: true, reason: 'stale_socket_remove_failed' }
}
