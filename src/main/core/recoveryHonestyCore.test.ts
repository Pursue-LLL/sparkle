import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateCarrierBytesRecovered,
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
        requireCarrierBytesRecovery: false,
      },
      nowMs: 1_030_000,
      currentMaxGapMs: baseline * (1 - RECOVERY_HONESTY_MIN_GAP_REDUCTION_RATIO) - 1,
      staleRequestIds: ['rid-a'],
    })
    assert.equal(evaluation.outcome, 'success')
    assert.equal(evaluation.gapReducedEnough, true)
  })

  it('marks ineffective when gap persists', () => {
    const evaluation = evaluateRecoveryHonesty({
      record: {
        kind: 'token_gap_rescue',
        attemptedAtMs: 1_000_000,
        baselineMaxGapMs: 188_586,
        staleRequestIds: ['10a5d11f'],
        requireCarrierBytesRecovery: false,
      },
      nowMs: 1_045_000,
      currentMaxGapMs: 180_000,
      staleRequestIds: ['10a5d11f'],
    })
    assert.equal(evaluation.outcome, 'ineffective')
  })

  it('marks ineffective on split-brain: gap drops but carrier bytes frozen (BUG-2026-08-05-001)', () => {
    const evaluation = evaluateRecoveryHonesty({
      record: {
        kind: 'stall_prune',
        attemptedAtMs: 1_000_000,
        baselineMaxGapMs: 200_000,
        staleRequestIds: ['rid-split'],
        baselineCarrier: { upload: 2458, download: 4972 },
        requireCarrierBytesRecovery: true,
        connectionId: 'conn-frozen',
      },
      nowMs: 1_030_000,
      currentMaxGapMs: 50_000,
      staleRequestIds: ['rid-split'],
      currentCarrier: { upload: 2458, download: 4972 },
    })
    assert.equal(evaluation.outcome, 'ineffective')
    assert.equal(evaluation.gapReducedEnough, true)
    assert.equal(evaluation.carrierRecovered, false)
  })

  it('marks success when gap drops and carrier bytes advance', () => {
    const evaluation = evaluateRecoveryHonesty({
      record: {
        kind: 'stall_prune',
        attemptedAtMs: 1_000_000,
        baselineMaxGapMs: 200_000,
        staleRequestIds: ['rid-ok'],
        baselineCarrier: { upload: 100, download: 200 },
        requireCarrierBytesRecovery: true,
      },
      nowMs: 1_030_000,
      currentMaxGapMs: 50_000,
      staleRequestIds: ['rid-ok'],
      currentCarrier: { upload: 150, download: 200 },
    })
    assert.equal(evaluation.outcome, 'success')
    assert.equal(evaluateCarrierBytesRecovered({ upload: 1, download: 2 }, { upload: 2, download: 2 }, true), true)
  })
})
