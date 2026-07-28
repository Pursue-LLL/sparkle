import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  armPartitionLatch,
  clearPartitionLatch,
  partitionLatchActive,
  resetPartitionLatchStateForTests,
  resolvePartitionLatchCandidate,
  shouldArmPartitionLatchFromBlindSpot,
} from './partitionLatchCore'
import { HUNG_SCAN_INTERVAL_MS } from './cursorTransportHealthCore'

describe('partitionLatchCore', () => {
  it('arms latch for 2 hung_scan intervals', () => {
    resetPartitionLatchStateForTests()
    const nowMs = 1_000_000
    armPartitionLatch(nowMs)
    assert.equal(partitionLatchActive(nowMs), true)
    assert.equal(partitionLatchActive(nowMs + 2 * HUNG_SCAN_INTERVAL_MS), false)
    assert.equal(partitionLatchActive(nowMs + 2 * HUNG_SCAN_INTERVAL_MS - 1), true)
  })

  it('returns connect_partition candidate while latch active', () => {
    resetPartitionLatchStateForTests()
    const nowMs = 2_000_000
    armPartitionLatch(nowMs)
    const candidate = resolvePartitionLatchCandidate(nowMs + 1_000, 30)
    assert.equal(candidate?.trigger, 'connect_partition')
    assert.equal(candidate?.plan, 'connect_rescue_bundle')
  })

  it('arms latch when only periodic_session would run (mass-PING merge miss)', () => {
    assert.equal(
      shouldArmPartitionLatchFromBlindSpot({
        partitionSignal: undefined,
        structuredPingCount: 2,
        candidate: { trigger: 'periodic_session', plan: 'session_warmth_bundle' },
      }),
      true,
    )
  })

  it('clearPartitionLatch resets active latch', () => {
    resetPartitionLatchStateForTests()
    const nowMs = 3_000_000
    armPartitionLatch(nowMs)
    assert.equal(partitionLatchActive(nowMs), true)
    clearPartitionLatch()
    assert.equal(partitionLatchActive(nowMs), false)
  })

  it('does not arm when rescue candidate already selected', () => {
    assert.equal(
      shouldArmPartitionLatchFromBlindSpot({
        partitionSignal: undefined,
        structuredPingCount: 2,
        candidate: undefined,
      }),
      true,
    )
    assert.equal(
      shouldArmPartitionLatchFromBlindSpot({
        partitionSignal: undefined,
        structuredPingCount: 2,
        candidate: { trigger: 'token_gap', plan: 'connect_rescue_bundle' },
      }),
      false,
    )
  })
})
