import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateTokenGapRescueIneffective,
  formatTokenGapRescueIneffectiveLogLine,
  shouldRecordTokenGapRescueExecution,
} from './tokenGapRescueIneffectiveCore'
import { NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS } from './hy2TunnelVitalityCore'

describe('tokenGapRescueIneffectiveCore R-18', () => {
  it('records executed_on_stale_rid and executed outcomes', () => {
    assert.equal(shouldRecordTokenGapRescueExecution('executed_on_stale_rid'), true)
    assert.equal(shouldRecordTokenGapRescueExecution('executed'), true)
    assert.equal(shouldRecordTokenGapRescueExecution('skipped_deferred'), false)
  })

  it('flags ineffective rescue when max_gap remains high and partition is green', () => {
    const nowMs = 10_000_000
    const observation = evaluateTokenGapRescueIneffective({
      record: {
        executedAtMs: nowMs - 30_000,
        outcome: 'executed_on_stale_rid',
        maxGapMs: 4_800_000,
        staleRequestIds: ['81afd4e9-830e-48b7-9209-906eb350edec'],
        partitionStale: false,
      },
      nowMs,
      maxGapMs: 4_867_477,
      staleRequestIds: ['81afd4e9-830e-48b7-9209-906eb350edec'],
      partitionStale: false,
      api2DelayMs: 243,
    })
    assert.ok(observation)
    assert.equal(observation?.partitionStale, 0)
    assert.match(formatTokenGapRescueIneffectiveLogLine(observation!), /TokenGapRescueIneffective/)
  })

  it('does not flag ineffective when max_gap recovered below threshold', () => {
    const nowMs = 20_000_000
    const observation = evaluateTokenGapRescueIneffective({
      record: {
        executedAtMs: nowMs - 30_000,
        outcome: 'executed',
        maxGapMs: 300_000,
        staleRequestIds: ['rid-1'],
        partitionStale: false,
      },
      nowMs,
      maxGapMs: NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS - 1,
      staleRequestIds: [],
      partitionStale: false,
    })
    assert.equal(observation, undefined)
  })
})
