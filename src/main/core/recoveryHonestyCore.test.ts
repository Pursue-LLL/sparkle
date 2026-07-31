import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateRecoveryHonesty,
  RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO,
} from './recoveryHonestyCore'

describe('recoveryHonestyCore R-34d', () => {
  it('marks success when max gap drops enough within window', () => {
    const baseline = 200_000
    const evaluation = evaluateRecoveryHonesty({
      record: {
        kind: 'stall_prune',
        attemptedAtMs: 1_000_000,
        baselineMaxGapMs: baseline,
        staleRequestIds: ['rid-a'],
      },
      nowMs: 1_030_000,
      currentMaxGapMs: baseline * (1 - RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO) - 1,
      staleRequestIds: ['rid-a'],
    })
    assert.equal(evaluation.outcome, 'success')
  })

  it('marks ineffective when gap persists', () => {
    const evaluation = evaluateRecoveryHonesty({
      record: {
        kind: 'token_gap_rescue',
        attemptedAtMs: 1_000_000,
        baselineMaxGapMs: 188_586,
        staleRequestIds: ['10a5d11f'],
      },
      nowMs: 1_045_000,
      currentMaxGapMs: 180_000,
      staleRequestIds: ['10a5d11f'],
    })
    assert.equal(evaluation.outcome, 'ineffective')
  })
})
