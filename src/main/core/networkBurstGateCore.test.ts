import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatCommercialBenchmarkBurstSkipReason,
  isNetworkBurstWindowActive,
  shouldSkipCommercialBenchmarkDuringBurst
} from './networkBurstGateCore'

describe('networkBurstGateCore', () => {
  it('detects active burst window', () => {
    const now = 1_700_000_000_000
    assert.equal(isNetworkBurstWindowActive(now + 60_000, now), true)
    assert.equal(isNetworkBurstWindowActive(now - 1, now), false)
    assert.equal(isNetworkBurstWindowActive(now, now), false)
  })

  it('skips commercial benchmark only during burst', () => {
    const now = 1_700_000_000_000
    assert.equal(shouldSkipCommercialBenchmarkDuringBurst(now + 1, now), true)
    assert.equal(shouldSkipCommercialBenchmarkDuringBurst(now, now), false)
  })

  it('formats remaining burst seconds for logs', () => {
    const now = 1_700_000_000_000
    const reason = formatCommercialBenchmarkBurstSkipReason(now + 125_000, now)
    assert.match(reason, /125s remaining/)
  })
})
