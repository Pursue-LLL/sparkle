// [INPUT] recoveryCircuitBreakerCore
// [OUTPUT] runtime circuit breaker state for hy2ParentSidecar
// [POS] P1/P1.5 — stop CarrierQuiesce / sidecar self-destruct; escalate restartCore when open.

import {
  createInitialRecoveryCircuitBreakerState,
  formatRecoveryCircuitBreakerLogLine,
  isRecoveryCircuitOpen,
  recordRecoveryFailure,
  recordRecoverySuccess,
  type RecoveryCircuitBreakerState,
} from './recoveryCircuitBreakerCore'

let state: RecoveryCircuitBreakerState = createInitialRecoveryCircuitBreakerState()
/** True while circuit is open and restartCore was deferred (cursor_conn>0). Retries on next gate. */
let coreRestartPending = false
let coreRestartInFlight = false
let lastCoreRestartDeferLogAtMs = 0

const ESCALATE_GUARD_TIMEOUT_MS = 12_000
const CORE_RESTART_DEFER_LOG_COOLDOWN_MS = 60_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function resetRecoveryCircuitBreakerForTests(): void {
  state = createInitialRecoveryCircuitBreakerState()
  coreRestartPending = false
  coreRestartInFlight = false
  lastCoreRestartDeferLogAtMs = 0
}

export function getRecoveryCircuitBreakerStateForTests(): RecoveryCircuitBreakerState {
  return { ...state }
}

export function isRecoveryCircuitRestartPendingForTests(): boolean {
  return coreRestartPending
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

async function evaluateEscalateRestartGuard(): Promise<{
  blocked: boolean
  snapshot: import('./marathonCoreRestartGuardCore').MarathonCoreRestartGuardSnapshot
  timedOut: boolean
}> {
  const { evaluateMarathonCoreColdRestart } = await import('./marathonCoreRestartGuard')
  let timedOut = false
  const guard = await Promise.race([
    evaluateMarathonCoreColdRestart('restartCore', true),
    delay(ESCALATE_GUARD_TIMEOUT_MS).then(async () => {
      timedOut = true
      return {
        blocked: true,
        snapshot: {
          quiesceActive: false,
          cursorConnectionCount: -1,
          recentActiveLifecycleStreamCount: -1,
          updatedAtMs: Date.now(),
        },
      }
    }),
  ])
  return { ...guard, timedOut }
}

async function logCoreRestartDeferred(
  reason: string,
  nowMs: number,
  force = false,
): Promise<void> {
  if (
    !force &&
    nowMs - lastCoreRestartDeferLogAtMs < CORE_RESTART_DEFER_LOG_COOLDOWN_MS
  ) {
    return
  }
  lastCoreRestartDeferLogAtMs = nowMs
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatRecoveryCircuitBreakerLogLine({
      outcome: 'blocked',
      reason,
    }),
  )
}

async function maybeEscalateCircuitOpenCoreRestart(nowMs: number): Promise<void> {
  if (coreRestartInFlight) {
    return
  }
  coreRestartInFlight = true
  try {
    const guard = await evaluateEscalateRestartGuard()
    if (guard.blocked) {
      coreRestartPending = true
      const deferReason = guard.timedOut
        ? 'core_restart_deferred guard_eval_timeout_ms=' + String(ESCALATE_GUARD_TIMEOUT_MS)
        : `core_restart_deferred cursor_conn=${guard.snapshot.cursorConnectionCount} ${guard.snapshot.quiesceActive ? 'quiesce=1' : 'quiesce=0'}`
      await logCoreRestartDeferred(deferReason, nowMs, !lastCoreRestartDeferLogAtMs)
      return
    }
    const { appendAppLog } = await import('../utils/log')
    await appendAppLog(
      formatRecoveryCircuitBreakerLogLine({
        outcome: 'open',
        reason: coreRestartPending
          ? 'circuit_open_escalate_restartCore_retry'
          : 'circuit_open_escalate_restartCore',
      }),
    )
    const { restartCore } = await import('./manager')
    await restartCore(true)
    state = recordRecoverySuccess(state)
    coreRestartPending = false
    await appendAppLog(
      formatRecoveryCircuitBreakerLogLine({
        outcome: 'reset',
        reason: 'core_restart_after_circuit_open',
        consecutiveFailures: 0,
      }),
    )
  } catch (error) {
    coreRestartPending = true
    const message = error instanceof Error ? error.message : String(error)
    await logCoreRestartDeferred(`core_restart_escalate_error ${message}`, nowMs, true)
  } finally {
    coreRestartInFlight = false
  }
}

export async function notifyRecoveryCircuitSuccess(): Promise<void> {
  const next = recordRecoverySuccess(state)
  if (next.consecutiveFailures === state.consecutiveFailures && next.openUntilMs === state.openUntilMs) {
    return
  }
  state = next
  coreRestartPending = false
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
    coreRestartPending = true
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
        '连续 3 次 parent UDP 恢复失败，已自动尝试重启核心。若仍异常请 Cmd+Q 退出 Sparkle 和 Cursor 后重开。\n' +
        '3 consecutive parent recovery failures; core restart attempted. If still stuck, Cmd+Q Sparkle + Cursor and reopen.',
      variant: 'danger',
      persistent: true,
    })
    void maybeEscalateCircuitOpenCoreRestart(input.nowMs)
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
