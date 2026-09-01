// [INPUT] recoveryCircuitBreakerCore
// [OUTPUT] runtime circuit breaker state for hy2ParentSidecar
// [POS] P1/P1.5 — stop CarrierQuiesce / sidecar self-destruct; open/block only.
// Escalation executes exclusively via RecoveryCoordinator (single owner).

import {
  createInitialRecoveryCircuitBreakerState,
  formatRecoveryCircuitBreakerLogLine,
  isRecoveryCircuitOpen,
  recordRecoveryFailure,
  recordRecoverySuccess,
  type RecoveryCircuitBreakerState,
} from './recoveryCircuitBreakerCore'

let state: RecoveryCircuitBreakerState = createInitialRecoveryCircuitBreakerState()

export function resetRecoveryCircuitBreakerForTests(): void {
  state = createInitialRecoveryCircuitBreakerState()
}

export function getRecoveryCircuitBreakerStateForTests(): RecoveryCircuitBreakerState {
  return { ...state }
}

export async function assertRecoveryCircuitAllowsMutation(input: {
  nowMs: number
}): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!isRecoveryCircuitOpen({ nowMs: input.nowMs, state })) {
    return { allowed: true }
  }
  return {
    allowed: false,
    reason: `recovery_circuit_breaker_open until_ms=${state.openUntilMs} last=${state.lastFailureReason}`,
  }
}

export async function notifyRecoveryCircuitSuccess(): Promise<void> {
  const next = recordRecoverySuccess(state)
  if (next.consecutiveFailures === state.consecutiveFailures && next.openUntilMs === state.openUntilMs) {
    return
  }
  state = next
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'reset',
      reason: 'recovery_success',
      consecutiveFailures: 0,
    }),
  )
}

export async function notifyRecoveryCircuitFailure(input: {
  nowMs: number
  reason: string
}): Promise<void> {
  const result = recordRecoveryFailure({
    nowMs: input.nowMs,
    state,
    reason: input.reason,
  })
  state = result.state
  const { appendAppLog } = await import('../utils/log')
  if (result.opened) {
    await appendAppLog(
      formatRecoveryCircuitBreakerLogLine({
        outcome: 'open',
        reason: input.reason,
        consecutiveFailures: state.consecutiveFailures,
        openUntilMs: state.openUntilMs,
        cooldownMs: state.openUntilMs - input.nowMs,
      }),
    )
    const { showNotification } = await import('../utils/notification')
    void showNotification({
      id: 'recovery-circuit-breaker-open',
      title: '代理恢复已熔断 / Proxy Recovery Circuit Open',
      body:
        '连续 3 次 parent UDP 恢复失败，RecoveryCoordinator 将执行 leaf failover 或 emergency。若仍异常请 Cmd+Q 退出 Sparkle 和 Cursor 后重开。\n' +
        '3 consecutive parent recovery failures; RecoveryCoordinator will failover or emergency-restart. If still stuck, Cmd+Q Sparkle + Cursor and reopen.',
      variant: 'danger',
      persistent: true,
    })
    return
  }
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'closed',
      reason: input.reason,
      consecutiveFailures: state.consecutiveFailures,
    }),
  )
}
