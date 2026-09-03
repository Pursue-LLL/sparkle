import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FAILOVER_SOAK_WINDOW_MS,
  isFailoverSoakWindowActive,
  resolveUdpParentStateForRecovery,
  shouldFailbackCursorDedicatedToHy2,
} from './recoveryFailoverGovernanceCore'

const nowMs = 2_000_000

describe('recoveryFailoverGovernanceCore @1.30.54', () => {
  it('vitality counterproof downgrades absent snapshot to unknown', () => {
    const state = resolveUdpParentStateForRecovery({
      resolution: {
        source: 'none',
        diagnostics: { totalConnections: 94, udpOnLeafStrict: 0, udpFullScanCandidates: 0 },
      },
      lastVitalitySuccessAtMs: nowMs - 5_000,
      nowMs,
    })
    assert.equal(state, 'unknown')
  })

  it('absent without recent vitality stays absent', () => {
    const state = resolveUdpParentStateForRecovery({
      resolution: {
        source: 'none',
        diagnostics: { totalConnections: 94, udpOnLeafStrict: 0, udpFullScanCandidates: 0 },
      },
      lastVitalitySuccessAtMs: nowMs - 120_000,
      nowMs,
    })
    assert.equal(state, 'absent')
  })

  it('failover soak blocks repeat escalation within window', () => {
    assert.equal(
      isFailoverSoakWindowActive({
        lastFailoverCompletedAtMs: nowMs - 5_000,
        nowMs,
      }),
      true,
    )
    assert.equal(
      isFailoverSoakWindowActive({
        lastFailoverCompletedAtMs: nowMs - FAILOVER_SOAK_WINDOW_MS - 1,
        nowMs,
      }),
      false,
    )
  })

  it('failback to HY2 when on Reality and vitality recent', () => {
    const decision = shouldFailbackCursorDedicatedToHy2({
      currentLeaf: 'JP-VPS-Reality',
      lastVitalitySuccessAtMs: nowMs - 3_000,
      nowMs,
    })
    assert.equal(decision.failback, true)
    assert.equal(decision.targetLeaf, 'JP-VPS-HY2')
  })

  it('no failback when already on HY2', () => {
    const decision = shouldFailbackCursorDedicatedToHy2({
      currentLeaf: 'JP-VPS-HY2',
      lastVitalitySuccessAtMs: nowMs - 3_000,
      nowMs,
    })
    assert.equal(decision.failback, false)
  })
})
