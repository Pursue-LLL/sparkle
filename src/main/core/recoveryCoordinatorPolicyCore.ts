// [INPUT] RecoveryFact · RecoveryEvent
// [OUTPUT] decideRecoveryCoordinatorAction · leaf/core state transitions
// [POS] Phase-1 SSOT — single recovery policy (pure functions, no I/O).

import { BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART } from './hy2ParentByteDeathRecoveryCore'

export type StallState = 'healthy' | 'suspected' | 'confirmed'
export type UdpParentState = 'present' | 'absent' | 'unknown'

export interface RecoveryFact {
  leafId: string
  parentId?: string
  observedAt: number
  generation: number
  stallState: StallState
  udpParentState: UdpParentState
  cursorConnectionCount: number
  providerReady: boolean
  tunReady: boolean
  proxyReady: boolean
}

export type RecoveryCoordinatorEventType =
  | 'STALL_DETECTED'
  | 'UDP_PARENT_ABSENT'
  | 'UDP_PARENT_UNKNOWN'
  | 'PROBE_ONLY_RESULT'
  | 'RECOVERY_FAILED'
  | 'CORE_RESTART_REQUIRED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'

export interface RecoveryCoordinatorEvent {
  type: RecoveryCoordinatorEventType
  leafId: string
  generation: number
  observedAt: number
  detail?: string
}

export type LeafRecoveryState =
  | 'HEALTHY'
  | 'SUSPECTED'
  | 'CONFIRMED_STALL'
  | 'LEAF_REPAIRING'
  | 'LEAF_VERIFYING'
  | 'FAILOVER'
  | 'DEGRADED'

export type CoreRecoveryState =
  | 'READY'
  | 'RESTART_PENDING'
  | 'DRAINING'
  | 'RESTARTING'
  | 'READINESS_VERIFYING'
  | 'DEGRADED'

export type RecoveryCoordinatorAction =
  | { kind: 'none'; reason: string }
  | { kind: 'close_udp_outbound'; leafId: string; reason: string }
  | { kind: 'request_emergency_core_recovery'; leafId: string; evidenceReason: string }
  | { kind: 'failover_leaf'; leafId: string; reason: string }
  | { kind: 'mark_degraded'; leafId: string; reason: string }

export interface RecoveryCoordinatorPolicyState {
  leafState: LeafRecoveryState
  coreState: CoreRecoveryState
  activeGeneration: number
  stateEnteredAtMs: number
  stateDeadlineMs: number
  /** Set true only after a successful leaf failover (not on dispatch). */
  failoverAttempted: boolean
  /** Dispatched failover attempts; emergency after MAX_FAILOVER_DISPATCHES. */
  failoverDispatchCount: number
}

export const MAX_FAILOVER_DISPATCHES = 2

export const LEAF_STATE_DEADLINE_MS: Record<Exclude<LeafRecoveryState, 'HEALTHY'>, number> = {
  SUSPECTED: 30_000,
  CONFIRMED_STALL: 60_000,
  LEAF_REPAIRING: 90_000,
  LEAF_VERIFYING: 60_000,
  FAILOVER: 120_000,
  DEGRADED: 300_000,
}

export function createInitialRecoveryCoordinatorPolicyState(
  nowMs: number,
): RecoveryCoordinatorPolicyState {
  return {
    leafState: 'HEALTHY',
    coreState: 'READY',
    activeGeneration: 0,
    stateEnteredAtMs: nowMs,
    stateDeadlineMs: nowMs + LEAF_STATE_DEADLINE_MS.SUSPECTED,
    failoverAttempted: false,
    failoverDispatchCount: 0,
  }
}

export function decideRecoveryCoordinatorAction(input: {
  state: RecoveryCoordinatorPolicyState
  fact: RecoveryFact
  event: RecoveryCoordinatorEvent
  nowMs: number
}): { state: RecoveryCoordinatorPolicyState; action: RecoveryCoordinatorAction } {
  const { fact, event, nowMs } = input
  let state = { ...input.state }

  if (event.generation < state.activeGeneration) {
    return {
      state,
      action: { kind: 'none', reason: 'stale_generation_discarded' },
    }
  }

  if (event.type === 'VERIFICATION_PASSED') {
    state.leafState = 'HEALTHY'
    state.coreState = 'READY'
    state.stateEnteredAtMs = nowMs
    return { state, action: { kind: 'none', reason: 'verified_recovered' } }
  }

  if (event.type === 'UDP_PARENT_UNKNOWN') {
    state.leafState = 'SUSPECTED'
    state.stateEnteredAtMs = nowMs
    state.stateDeadlineMs = nowMs + LEAF_STATE_DEADLINE_MS.SUSPECTED
    return { state, action: { kind: 'none', reason: 'udp_parent_unknown_diagnostic_only' } }
  }

  if (
    event.type === 'UDP_PARENT_ABSENT' ||
    event.detail === BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART ||
    event.type === 'CORE_RESTART_REQUIRED'
  ) {
    state.leafState = 'CONFIRMED_STALL'
    state.stateEnteredAtMs = nowMs
    state.stateDeadlineMs = nowMs + LEAF_STATE_DEADLINE_MS.CONFIRMED_STALL
    if (
      fact.cursorConnectionCount > 0 &&
      !state.failoverAttempted &&
      state.failoverDispatchCount < MAX_FAILOVER_DISPATCHES
    ) {
      state.failoverDispatchCount += 1
      state.leafState = 'FAILOVER'
      state.coreState = 'READY'
      return {
        state,
        action: {
          kind: 'failover_leaf',
          leafId: fact.leafId,
          reason: 'udp_absent_failover_before_core_restart',
        },
      }
    }
    state.coreState = 'RESTART_PENDING'
    return {
      state,
      action: {
        kind: 'request_emergency_core_recovery',
        leafId: fact.leafId,
        evidenceReason:
          event.detail ?? BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      },
    }
  }

  if (event.type === 'PROBE_ONLY_RESULT') {
    state.leafState = 'CONFIRMED_STALL'
    if (
      fact.cursorConnectionCount > 0 &&
      !state.failoverAttempted &&
      state.failoverDispatchCount < MAX_FAILOVER_DISPATCHES
    ) {
      state.failoverDispatchCount += 1
      state.leafState = 'FAILOVER'
      state.coreState = 'READY'
      return {
        state,
        action: {
          kind: 'failover_leaf',
          leafId: fact.leafId,
          reason: 'probe_only_failover_before_core_restart',
        },
      }
    }
    state.coreState = 'RESTART_PENDING'
    return {
      state,
      action: {
        kind: 'request_emergency_core_recovery',
        leafId: fact.leafId,
        evidenceReason: 'byte_death_probe_only_without_udp_close',
      },
    }
  }

  if (fact.udpParentState === 'present' && state.leafState === 'CONFIRMED_STALL') {
    state.leafState = 'LEAF_REPAIRING'
    state.stateEnteredAtMs = nowMs
    state.stateDeadlineMs = nowMs + LEAF_STATE_DEADLINE_MS.LEAF_REPAIRING
    return {
      state,
      action: {
        kind: 'close_udp_outbound',
        leafId: fact.leafId,
        reason: 'udp_parent_present_close_and_verify',
      },
    }
  }

  if (nowMs >= state.stateDeadlineMs && state.leafState !== 'HEALTHY') {
    state.leafState = 'FAILOVER'
    state.stateEnteredAtMs = nowMs
    return {
      state,
      action: {
        kind: 'failover_leaf',
        leafId: fact.leafId,
        reason: 'leaf_state_deadline_expired',
      },
    }
  }

  if (event.type === 'STALL_DETECTED') {
    state.leafState = 'SUSPECTED'
    state.stateEnteredAtMs = nowMs
    state.stateDeadlineMs = nowMs + LEAF_STATE_DEADLINE_MS.SUSPECTED
  }

  return { state, action: { kind: 'none', reason: 'no_action_for_event' } }
}
