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

/** BUG-008: dial failure cluster bypasses open circuit — cluster is stronger evidence than prior failures. */
export async function forceClearRecoveryCircuitForClusterRecovery(
  nowMs: number,
  clusterSize: number,
): Promise<void> {
  if (!isRecoveryCircuitOpen({ nowMs, state })) {
    return
  }
  state = recordRecoverySuccess(state)
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'reset',
      reason: `dial_failure_cluster_bypass cluster_size=${clusterSize}`,
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
    const { notifyCollectiveDeathAlert } = await import('./collectiveDeathAlert')
    void notifyCollectiveDeathAlert({
      trigger: 'recovery_circuit_open',
      title: '代理恢复已熔断',
      body:
        '连续恢复失败，系统将尝试切换节点或紧急重建。可点击「复制 Bug 信息」粘贴给 AI 分析。',
      tsMs: input.nowMs,
      evidenceReason: input.reason,
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
