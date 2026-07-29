import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  armPartitionLatch,
  clearPartitionLatch,
  getPartitionLatchArmedAtMs,
  getPartitionLatchStaleRequestIds,
  partitionLatchActive,
  resetPartitionLatchStateForTests,
  resolvePartitionLatchCandidate,
  shouldArmPartitionLatchFromBlindSpot,
  shouldArmPartitionLatchFromMassPingSync,
  shouldArmPartitionLatchFromTransportSync,
  collectPartitionLatchRequestIds,
  shouldMergePartitionLatchFromLateServerEof,
  collectLateServerEofPartitionLatchRequestIds,
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
    armPartitionLatch(nowMs, ['rid-a', 'rid-b'])
    const candidate = resolvePartitionLatchCandidate(nowMs + 1_000, 30)
    assert.equal(candidate?.trigger, 'connect_partition')
    assert.equal(candidate?.plan, 'connect_rescue_bundle')
    assert.deepEqual(candidate?.staleRequestIds, ['rid-a', 'rid-b'])
    assert.equal(candidate?.staleRequestIdCount, 2)
  })

  it('merges stale request ids across repeated latch arms (P28)', () => {
    resetPartitionLatchStateForTests()
    const nowMs = 2_500_000
    armPartitionLatch(nowMs, ['rid-a'])
    armPartitionLatch(nowMs + 1_000, ['rid-b', 'rid-a'])
    assert.deepEqual(getPartitionLatchStaleRequestIds(), ['rid-a', 'rid-b'])
    assert.equal(getPartitionLatchArmedAtMs(), nowMs + 1_000)
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

  it('arms latch from mass ping sync batch (P26)', () => {
    assert.equal(
      shouldArmPartitionLatchFromMassPingSync([
        { ts: 1, errMsg: 'PING timed out', connectCode: '14' },
        { ts: 2, errMsg: 'PING timed out', connectCode: '14' },
      ]),
      true,
    )
    assert.equal(
      shouldArmPartitionLatchFromMassPingSync([
        { ts: 1, errMsg: 'PING timed out', connectCode: '14' },
      ]),
      false,
    )
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

  it('P29: arms latch from mixed ping + server-eof batch and collects eof reqIds', () => {
    assert.equal(
      shouldArmPartitionLatchFromTransportSync([
        { ts: 1, errMsg: 'PING timed out', connectCode: '14' },
        {
          ts: 2,
          kind: 'http_sse_transport_failure',
          streamPrimarySub: 'server-eof',
          originalRequestId: '165cb7db-parent',
        },
      ]),
      true,
    )
    assert.equal(
      shouldArmPartitionLatchFromTransportSync([
        {
          ts: 1,
          kind: 'http_sse_transport_failure',
          streamPrimarySub: 'server-eof',
          originalRequestId: 'solo-eof',
        },
      ]),
      false,
    )
    assert.deepEqual(
      collectPartitionLatchRequestIds([
        { ts: 1, errMsg: 'PING timed out', connectCode: '14', originalRequestId: 'rid-ping' },
        {
          ts: 2,
          kind: 'http_sse_transport_failure',
          streamPrimarySub: 'server-eof',
          originalRequestId: '165cb7db-parent',
        },
      ]),
      ['rid-ping', '165cb7db-parent'],
    )
  })

  it('P29b: merges late server-eof reqIds while partition latch active', () => {
    resetPartitionLatchStateForTests()
    const nowMs = 4_000_000
    armPartitionLatch(nowMs - 5_000, ['rid-ping-a'])
    assert.equal(
      shouldMergePartitionLatchFromLateServerEof(
        [
          {
            ts: 1,
            kind: 'http_sse_transport_failure',
            streamPrimarySub: 'server-eof',
            originalRequestId: '165cb7db-parent',
          },
        ],
        nowMs,
      ),
      true,
    )
    assert.deepEqual(
      collectLateServerEofPartitionLatchRequestIds([
        {
          ts: 1,
          kind: 'http_sse_transport_failure',
          streamPrimarySub: 'server-eof',
          originalRequestId: '165cb7db-parent',
        },
      ]),
      ['165cb7db-parent'],
    )
    armPartitionLatch(nowMs, collectLateServerEofPartitionLatchRequestIds([
      {
        ts: 1,
        kind: 'http_sse_transport_failure',
        streamPrimarySub: 'server-eof',
        originalRequestId: '165cb7db-parent',
      },
    ]))
    assert.deepEqual(getPartitionLatchStaleRequestIds(), ['rid-ping-a', '165cb7db-parent'])
  })
})
