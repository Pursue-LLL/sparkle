import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
} from './hy2ParentByteDeathRecoveryCore'
import {
  createInitialRecoveryCoordinatorPolicyState,
  decideRecoveryCoordinatorAction,
  MAX_FAILOVER_DISPATCHES,
  type RecoveryFact,
} from './recoveryCoordinatorPolicyCore'

const nowMs = 2_000_000

function baseFact(overrides: Partial<RecoveryFact> = {}): RecoveryFact {
  return {
    leafId: 'JP-VPS-HY2',
    observedAt: nowMs,
    generation: 1,
    stallState: 'confirmed',
    udpParentState: 'absent',
    cursorConnectionCount: 40,
    providerReady: true,
    tunReady: true,
    proxyReady: true,
    ...overrides,
  }
}

describe('recoveryCoordinatorPolicyCore @phase1', () => {
  it('UDP absent with active cursor_conn → failover before core restart', () => {
    const state = createInitialRecoveryCoordinatorPolicyState(nowMs)
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact(),
      event: {
        type: 'UDP_PARENT_ABSENT',
        leafId: 'JP-VPS-HY2',
        generation: 1,
        observedAt: nowMs,
        detail: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      },
      nowMs,
    })
    assert.equal(result.action.kind, 'failover_leaf')
    assert.equal(result.action.reason, 'udp_absent_failover_before_core_restart')
    assert.equal(result.state.coreState, 'READY')
    assert.equal(result.state.failoverAttempted, false)
    assert.equal(result.state.failoverDispatchCount, 1)
  })

  it('UDP absent with cursor_conn>0 and dispatch count exhausted → emergency', () => {
    const state = {
      ...createInitialRecoveryCoordinatorPolicyState(nowMs),
      failoverDispatchCount: MAX_FAILOVER_DISPATCHES,
    }
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact(),
      event: {
        type: 'UDP_PARENT_ABSENT',
        leafId: 'JP-VPS-HY2',
        generation: 1,
        observedAt: nowMs,
        detail: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      },
      nowMs,
    })
    assert.equal(result.action.kind, 'request_emergency_core_recovery')
    assert.equal(result.state.coreState, 'RESTART_PENDING')
  })

  it('UDP absent with cursor_conn=0 → emergency core recovery', () => {
    const state = createInitialRecoveryCoordinatorPolicyState(nowMs)
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact({ cursorConnectionCount: 0 }),
      event: {
        type: 'UDP_PARENT_ABSENT',
        leafId: 'JP-VPS-HY2',
        generation: 1,
        observedAt: nowMs,
        detail: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      },
      nowMs,
    })
    assert.equal(result.action.kind, 'request_emergency_core_recovery')
    assert.equal(result.state.coreState, 'RESTART_PENDING')
  })

  it('UDP absent after failover attempted → emergency core recovery', () => {
    const state = {
      ...createInitialRecoveryCoordinatorPolicyState(nowMs),
      failoverAttempted: true,
    }
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact(),
      event: {
        type: 'UDP_PARENT_ABSENT',
        leafId: 'JP-VPS-HY2',
        generation: 1,
        observedAt: nowMs,
        detail: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      },
      nowMs,
    })
    assert.equal(result.action.kind, 'request_emergency_core_recovery')
    assert.equal(result.state.coreState, 'RESTART_PENDING')
  })

  it('unknown UDP → diagnostic only, no mutation action', () => {
    const state = createInitialRecoveryCoordinatorPolicyState(nowMs)
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact({ udpParentState: 'unknown', stallState: 'suspected' }),
      event: {
        type: 'UDP_PARENT_UNKNOWN',
        leafId: 'JP-VPS-HY2',
        generation: 1,
        observedAt: nowMs,
      },
      nowMs,
    })
    assert.equal(result.action.kind, 'none')
    assert.equal(result.action.reason, 'udp_parent_unknown_diagnostic_only')
  })

  it('stale generation discarded', () => {
    const state = {
      ...createInitialRecoveryCoordinatorPolicyState(nowMs),
      activeGeneration: 5,
    }
    const result = decideRecoveryCoordinatorAction({
      state,
      fact: baseFact({ generation: 3 }),
      event: {
        type: 'UDP_PARENT_ABSENT',
        leafId: 'JP-VPS-HY2',
        generation: 3,
        observedAt: nowMs,
      },
      nowMs,
    })
    assert.equal(result.action.reason, 'stale_generation_discarded')
  })
})
