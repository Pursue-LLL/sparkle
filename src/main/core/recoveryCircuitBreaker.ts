// [INPUT] recoveryCircuitBreakerCore
// [OUTPUT] runtime circuit breaker state for hy2ParentSidecar
// [POS] P1 runtime module — process-local breaker (reset on Sparkle restart).

import {
  createInitialRecoveryCircuitBreakerState,
  formatRecoveryCircuitBreakerLogLine,
  isRecoveryCircuitOpen,
  recordRecoveryFailure,
  recordRecoverySuccess,
  type RecoveryCircuitBreakerState,
} from './recoveryCircuitBreakerCore'

let state: RecoveryCircuitBreakerState = createInitialRecoveryCircuitBreakerState()
let coreRestartEscalationOpenUntilMs = 0

export function resetRecoveryCircuitBreakerForTests(): void {
  state = createInitialRecoveryCircuitBreakerState()
  coreRestartEscalationOpenUntilMs = 0
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
  void maybeEscalateCircuitOpenCoreRestart(input.nowMs)
  return {
    allowed: false,
    reason: `recovery_circuit_breaker_open until_ms=${state.openUntilMs} last=${state.lastFailureReason}`,
  }
}

async function maybeEscalateCircuitOpenCoreRestart(nowMs: number): Promise<void> {
  if (coreRestartEscalationOpenUntilMs === state.openUntilMs) {
    return
  }
  coreRestartEscalationOpenUntilMs = state.openUntilMs
  const { evaluateMarathonCoreColdRestart } = await import('./marathonCoreRestartGuard')
  const guard = await evaluateMarathonCoreColdRestart('restartCore', true)
  if (guard.blocked) {
    const { appendAppLog } = await import('../utils/log')
    await appendAppLog(
      formatRecoveryCircuitBreakerLogLine({
        outcome: 'blocked',
        reason: `core_restart_deferred cursor_conn=${guard.snapshot.cursorConnectionCount} ${guard.snapshot.quiesceActive ? 'quiesce=1' : 'quiesce=0'}`,
      }),
    )
    return
  }
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'open',
      reason: 'circuit_open_escalate_restartCore',
    }),
  )
  const { restartCore } = await import('./manager')
  await restartCore(true)
  state = recordRecoverySuccess(state)
  coreRestartEscalationOpenUntilMs = 0
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'reset',
      reason: 'core_restart_after_circuit_open',
      consecutiveFailures: 0,
    }),
  )
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
        '连续 3 次 parent UDP 恢复失败。请 Cmd+Q 退出 Sparkle 和 Cursor 后重新打开。\n' +
        '3 consecutive parent recovery failures. Cmd+Q Sparkle + Cursor, wait 5s, reopen.',
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
