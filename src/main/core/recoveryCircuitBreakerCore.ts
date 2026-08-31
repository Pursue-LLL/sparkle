// [INPUT] consecutive recovery failure counts · open-until timestamp
// [OUTPUT] recordRecoveryFailure · isRecoveryCircuitOpen · formatRecoveryCircuitBreakerLogLine
// [POS] P1 SSOT — stop CarrierQuiesce / sidecar self-destruct loops after repeated failures.

/** Consecutive sidecar/UDP refresh failures before opening the circuit. */
export const RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3

/** Cooldown after open — no parent UDP mutation until elapsed or manual Sparkle restart. */
export const RECOVERY_CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60_000

export type RecoveryCircuitBreakerOutcome = 'closed' | 'open' | 'half_open'

export interface RecoveryCircuitBreakerState {
  consecutiveFailures: number
  openUntilMs: number
  lastFailureReason: string
}

export function createInitialRecoveryCircuitBreakerState(): RecoveryCircuitBreakerState {
  return {
    consecutiveFailures: 0,
    openUntilMs: 0,
    lastFailureReason: '',
  }
}

export function isRecoveryCircuitOpen(input: {
  nowMs: number
  state: RecoveryCircuitBreakerState
}): boolean {
  return input.nowMs < input.state.openUntilMs
}

export function recordRecoverySuccess(
  state: RecoveryCircuitBreakerState,
): RecoveryCircuitBreakerState {
  if (state.consecutiveFailures === 0 && state.openUntilMs === 0) {
    return state
  }
  return {
    consecutiveFailures: 0,
    openUntilMs: 0,
    lastFailureReason: '',
  }
}

export function recordRecoveryFailure(input: {
  nowMs: number
  state: RecoveryCircuitBreakerState
  reason: string
  failureThreshold?: number
  cooldownMs?: number
}): {
  state: RecoveryCircuitBreakerState
  opened: boolean
} {
  const failureThreshold =
    input.failureThreshold ?? RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD
  const cooldownMs = input.cooldownMs ?? RECOVERY_CIRCUIT_BREAKER_COOLDOWN_MS
  const consecutiveFailures = input.state.consecutiveFailures + 1
  if (consecutiveFailures < failureThreshold) {
    return {
      opened: false,
      state: {
        consecutiveFailures,
        openUntilMs: input.state.openUntilMs,
        lastFailureReason: input.reason,
      },
    }
  }
  return {
    opened: true,
    state: {
      consecutiveFailures,
      openUntilMs: input.nowMs + cooldownMs,
      lastFailureReason: input.reason,
    },
  }
}

export function formatRecoveryCircuitBreakerLogLine(input: {
  outcome: 'open' | 'closed' | 'blocked' | 'reset'
  reason: string
  consecutiveFailures?: number
  openUntilMs?: number
  cooldownMs?: number
}): string {
  const parts = [
    '[RecoveryCircuitBreaker]:',
    `outcome=${input.outcome}`,
    `reason=${input.reason}`,
  ]
  if (input.consecutiveFailures != null) {
    parts.push(`consecutive_failures=${input.consecutiveFailures}`)
  }
  if (input.openUntilMs != null) {
    parts.push(`open_until_ms=${input.openUntilMs}`)
  }
  if (input.cooldownMs != null) {
    parts.push(`cooldown_ms=${input.cooldownMs}`)
  }
  return `${parts.join(' ')}\n`
}
