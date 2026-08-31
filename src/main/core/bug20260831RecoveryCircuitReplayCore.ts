// [INPUT] BUG-2026-08-31-001 incident fixtures · recoveryCircuitBreakerCore
// [OUTPUT] runBug20260831RecoveryCircuitReplayGate
// [POS] P1 regression gate — replay 8/31 CarrierQuiesce / sidecar self-destruct loop.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createInitialRecoveryCircuitBreakerState,
  isRecoveryCircuitOpen,
  recordRecoveryFailure,
  RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
} from './recoveryCircuitBreakerCore'

const ROOT = dirname(fileURLToPath(import.meta.url))

export interface Bug20260831ReplayVerdict {
  fixtureId: string
  ok: boolean
  detail: string
}

export interface Bug20260831RecoveryCircuitReplayResult {
  ok: boolean
  verdicts: Bug20260831ReplayVerdict[]
}

/** 8/31 16:30 CST: sidecar fail every ~5s — circuit must open before minute 2. */
export function replayBug20260831SidecarFailLoopOpensCircuit(): Bug20260831ReplayVerdict {
  const t0 = Date.parse('2026-08-31T08:30:03.255Z')
  let state = createInitialRecoveryCircuitBreakerState()
  const failureOffsetsMs = [0, 5000, 15000, 20000]
  let openedAtMs: number | undefined
  for (const offsetMs of failureOffsetsMs) {
    const step = recordRecoveryFailure({
      nowMs: t0 + offsetMs,
      state,
      reason: 'emergency_stall_escalation_r1',
    })
    state = step.state
    if (step.opened) {
      openedAtMs = t0 + offsetMs
      break
    }
  }
  const ok =
    openedAtMs != null &&
    openedAtMs <= t0 + 20_000 &&
    isRecoveryCircuitOpen({ nowMs: (openedAtMs ?? t0) + 1000, state })
  return {
    fixtureId: '0831_sidecar_fail_loop_opens_circuit',
    ok,
    detail: ok
      ? `circuit opened at +${openedAtMs! - t0}ms`
      : `circuit never opened threshold=${RECOVERY_CIRCUIT_BREAKER_FAILURE_THRESHOLD}`,
  }
}

/** hy2ParentSidecar must gate mutations when circuit is open. */
export function replayBug20260831SidecarSourceWiresCircuitGate(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'hy2ParentSidecar.ts'), 'utf8')
  const ok =
    source.includes('assertRecoveryCircuitAllowsMutation') &&
    source.includes('notifyRecoveryCircuitFailure') &&
    source.includes('mutationClosedParentUdp')
  return {
    fixtureId: '0831_sidecar_wires_circuit_gate',
    ok,
    detail: ok ? 'hy2ParentSidecar wires circuit gate + failure accounting' : 'missing circuit wiring',
  }
}

/** SEL R2 parent_udp_refresh must respect circuit breaker (no bypass). */
export function replayBug20260831SelR2RespectsCircuit(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'mihomoQuicSilentStallRecovery.ts'), 'utf8')
  const blockIndex = source.indexOf("if (plan.action === 'parent_udp_refresh')")
  const section =
    blockIndex >= 0 ? source.slice(blockIndex, blockIndex + 800) : ''
  const ok =
    blockIndex >= 0 && section.includes('assertRecoveryCircuitAllowsMutation')
  return {
    fixtureId: '0831_sel_r2_respects_circuit',
    ok,
    detail: ok
      ? 'parent_udp_refresh checks circuit before rotation'
      : 'SEL R2 bypasses recovery circuit breaker',
  }
}

/** Probe-only sidecar success must not reset breaker without UDP close. */
export function replayBug20260831ProbeOnlyNoFalseReset(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'hy2ParentSidecar.ts'), 'utf8')
  const ok =
    source.includes('probeOnlyFalseSuccess') &&
    source.includes('resolvedOutcome === \'executed\' && parentUdpClosedThisInvocation')
  return {
    fixtureId: '0831_probe_only_no_false_reset',
    ok,
    detail: ok
      ? 'success reset requires parent UDP close'
      : 'probe-only sidecar can false-reset circuit',
  }
}

/** recoveryCircuitBreaker notifies user on open. */
export function replayBug20260831CircuitOpenNotification(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'recoveryCircuitBreaker.ts'), 'utf8')
  const ok =
    source.includes('recovery-circuit-breaker-open') &&
    source.includes('showNotification')
  return {
    fixtureId: '0831_circuit_open_user_notification',
    ok,
    detail: ok ? 'circuit open triggers user notification' : 'missing circuit open notification',
  }
}

/** frozen prune / close_frozen must respect circuit breaker (no bypass). */
export function replayBug20260831FrozenPruneRespectsCircuit(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'mihomoQuicSilentStallRecovery.ts'), 'utf8')
  const blockIndex = source.indexOf('async function closeStalledConnection')
  const section = blockIndex >= 0 ? source.slice(blockIndex, blockIndex + 500) : ''
  const ok = blockIndex >= 0 && section.includes('assertRecoveryCircuitAllowsMutation')
  return {
    fixtureId: '0831_frozen_prune_respects_circuit',
    ok,
    detail: ok
      ? 'closeStalledConnection checks circuit before mihomoCloseConnection'
      : 'frozen prune bypasses recovery circuit breaker',
  }
}

/** cursorTransportHealth L1/L2 must respect circuit breaker. */
export function replayBug20260831CursorTransportHealthRespectsCircuit(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'cursorTransportHealth.ts'), 'utf8')
  const ok =
    source.includes('executeRecoveryL1') &&
    source.includes('executeRecoveryL2') &&
    source.includes('assertRecoveryCircuitAllowsMutation')
  return {
    fixtureId: '0831_cursor_transport_health_respects_circuit',
    ok,
    detail: ok
      ? 'L1/L2 check circuit before mihomo close'
      : 'cursorTransportHealth bypasses recovery circuit breaker',
  }
}

/** Circuit open must keep retrying restartCore after cursor_conn defer (no one-shot lock). */
export function replayBug20260831CircuitRestartRetriesAfterDefer(): Bug20260831ReplayVerdict {
  const source = readFileSync(join(ROOT, 'recoveryCircuitBreaker.ts'), 'utf8')
  const ok =
    source.includes('coreRestartPending') &&
    source.includes('circuit_open_escalate_restartCore_retry') &&
    !source.includes('coreRestartEscalationOpenUntilMs')
  return {
    fixtureId: '0831_circuit_restart_retries_after_defer',
    ok,
    detail: ok
      ? 'deferred restartCore retries on subsequent gate checks'
      : 'circuit restart still one-shot locked after defer',
  }
}

/** AI groups must exclude Marathon Cursor HY2 leaves. */
export function replayBug20260831AiExcludesMarathonHy2(): Bug20260831ReplayVerdict {
  const core = readFileSync(join(ROOT, 'aiTrafficIsolationCore.ts'), 'utf8')
  const factory = readFileSync(join(ROOT, 'factory.ts'), 'utf8')
  const ok =
    core.includes('excludeMarathonHy2FromAiProxyGroups') &&
    factory.includes('excludeMarathonHy2FromAiProxyGroups')
  return {
    fixtureId: '0831_ai_excludes_marathon_hy2',
    ok,
    detail: ok
      ? 'factory wires AI traffic isolation from Marathon HY2'
      : 'AI traffic isolation missing from factory',
  }
}

export function runBug20260831RecoveryCircuitReplayGate(): Bug20260831RecoveryCircuitReplayResult {
  const verdicts = [
    replayBug20260831SidecarFailLoopOpensCircuit(),
    replayBug20260831SidecarSourceWiresCircuitGate(),
    replayBug20260831SelR2RespectsCircuit(),
    replayBug20260831ProbeOnlyNoFalseReset(),
    replayBug20260831CircuitOpenNotification(),
    replayBug20260831FrozenPruneRespectsCircuit(),
    replayBug20260831CursorTransportHealthRespectsCircuit(),
    replayBug20260831CircuitRestartRetriesAfterDefer(),
    replayBug20260831AiExcludesMarathonHy2(),
  ]
  return {
    ok: verdicts.every((verdict) => verdict.ok),
    verdicts,
  }
}
