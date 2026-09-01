import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateByteDeathRecoveryHonesty,
  shouldEvaluateByteDeathRecoveryHonesty,
} from './recoveryByteDeathVerifierCore'

describe('recoveryByteDeathVerifierCore @phase1', () => {
  it('probe-only without UDP close is ineffective', () => {
    const evaluation = evaluateByteDeathRecoveryHonesty({
      record: {
        leafId: 'JP-VPS-HY2',
        attemptedAtMs: 1000,
        udpParentClosed: false,
        baselineMaxByteStallMs: 60_000,
      },
      nowMs: 10_000,
      currentMaxByteStallMs: 1000,
      api2ProbeOk: true,
    })
    assert.equal(evaluation.outcome, 'ineffective')
    assert.equal(evaluation.reason, 'byte_death_probe_only_without_udp_close')
  })

  it('UDP closed + carrier bytes + api2 → success', () => {
    const evaluation = evaluateByteDeathRecoveryHonesty({
      record: {
        leafId: 'JP-VPS-HY2',
        attemptedAtMs: 1000,
        udpParentClosed: true,
        baselineMaxByteStallMs: 60_000,
        baselineCarrier: { upload: 100, download: 200 },
      },
      nowMs: 10_000,
      currentMaxByteStallMs: 1000,
      currentCarrier: { upload: 150, download: 250 },
      api2ProbeOk: true,
    })
    assert.equal(evaluation.outcome, 'success')
    assert.equal(evaluation.carrierRecovered, true)
  })

  it('UDP closed but api2 failed → ineffective', () => {
    const evaluation = evaluateByteDeathRecoveryHonesty({
      record: {
        leafId: 'JP-VPS-HY2',
        attemptedAtMs: 1000,
        udpParentClosed: true,
        baselineMaxByteStallMs: 60_000,
        baselineCarrier: { upload: 100, download: 200 },
      },
      nowMs: 10_000,
      currentMaxByteStallMs: 1000,
      currentCarrier: { upload: 150, download: 250 },
      api2ProbeOk: false,
    })
    assert.equal(evaluation.outcome, 'ineffective')
    assert.equal(evaluation.reason, 'byte_death_api2_probe_failed')
  })

  it('shouldEvaluate respects min eval window', () => {
    const record = {
      leafId: 'JP-VPS-HY2',
      attemptedAtMs: 1000,
      udpParentClosed: true,
      baselineMaxByteStallMs: 60_000,
    }
    assert.equal(shouldEvaluateByteDeathRecoveryHonesty(record, 3000), false)
    assert.equal(shouldEvaluateByteDeathRecoveryHonesty(record, 8000), true)
  })
})
