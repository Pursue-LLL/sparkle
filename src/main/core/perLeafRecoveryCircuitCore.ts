// [INPUT] per-leaf failure records · failure class
// [OUTPUT] recordLeafRecoveryFailure · isLeafRecoveryCircuitOpen
// [POS] Phase-1 SSOT — per-leaf circuit isolation (replaces global-only view).

export type LeafFailureClass =
  | 'udp_parent_absent'
  | 'probe_only'
  | 'tls_failure'
  | 'provider_unhealthy'

export interface LeafRecoveryCircuitKey {
  leafId: string
  failureClass: LeafFailureClass
}

export interface LeafRecoveryCircuitState {
  consecutiveFailures: number
  openUntilMs: number
  lastFailureReason: string
}

export const LEAF_RECOVERY_CIRCUIT_FAILURE_THRESHOLD = 3
export const LEAF_RECOVERY_CIRCUIT_COOLDOWN_MS = 3 * 60_000

export function leafCircuitKey(input: LeafRecoveryCircuitKey): string {
  return `${input.leafId}::${input.failureClass}`
}

export function createInitialLeafRecoveryCircuitState(): LeafRecoveryCircuitState {
  return {
    consecutiveFailures: 0,
    openUntilMs: 0,
    lastFailureReason: '',
  }
}

export function isLeafRecoveryCircuitOpen(input: {
  nowMs: number
  state: LeafRecoveryCircuitState
}): boolean {
  return input.nowMs < input.state.openUntilMs
}

export function recordLeafRecoveryFailure(input: {
  nowMs: number
  state: LeafRecoveryCircuitState
  reason: string
}): { state: LeafRecoveryCircuitState; opened: boolean } {
  const consecutiveFailures = input.state.consecutiveFailures + 1
  const opened = consecutiveFailures >= LEAF_RECOVERY_CIRCUIT_FAILURE_THRESHOLD
  return {
    opened,
    state: {
      consecutiveFailures,
      lastFailureReason: input.reason,
      openUntilMs: opened
        ? input.nowMs + LEAF_RECOVERY_CIRCUIT_COOLDOWN_MS
        : input.state.openUntilMs,
    },
  }
}

export function recordLeafRecoverySuccess(
  _state: LeafRecoveryCircuitState,
): LeafRecoveryCircuitState {
  return createInitialLeafRecoveryCircuitState()
}

export function classifyLeafFailureReason(reason: string): LeafFailureClass {
  if (reason.includes('udp_absent') || reason.includes('no_udp_outbound')) {
    return 'udp_parent_absent'
  }
  if (reason.includes('probe_only')) {
    return 'probe_only'
  }
  if (reason.includes('tls') || reason.includes('ECONNRESET')) {
    return 'tls_failure'
  }
  return 'provider_unhealthy'
}
