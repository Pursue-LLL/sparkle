import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildSyntheticConnectPartitionSignal,
  isLatencyDeltaRescueEligible,
  mergeConnectPartitionSignals,
  nextLatencyDeltaRescueStreak,
  nextWarmthDeferStreak,
  resolveRecentVpsL4OkForNode,
  shouldEmitSyntheticConnectPartition,
  shouldEmitUltraConnObservability,
} from './connectPingStormCore'
import { resolveConnectPartitionWindowMs } from './connectPartitionDetectCore'

const NOW = Date.parse('2026-07-27T09:57:15.000Z')

describe('connectPingStormCore', () => {
  it('prefers jsonl partition signal over synthetic', () => {
    const jsonl = {
      pingFailureCount: 3,
      windowMs: 8_000,
      cursorConnectionCount: 816,
      sampleRequestIds: ['rid-a'],
    }
    const synthetic = buildSyntheticConnectPartitionSignal(816)
    const merged = mergeConnectPartitionSignals(jsonl, synthetic)
    assert.equal(merged?.source, 'jsonl')
    assert.deepEqual(merged?.sampleRequestIds, ['rid-a'])
  })

  it('emits synthetic partition when defer streak and vps l4 ok without jsonl', () => {
    assert.equal(
      shouldEmitSyntheticConnectPartition(816, 2, true, false),
      true,
    )
    assert.equal(
      shouldEmitSyntheticConnectPartition(816, 1, true, false),
      false,
    )
    assert.equal(
      shouldEmitSyntheticConnectPartition(816, 2, false, false),
      false,
    )
    assert.equal(
      shouldEmitSyntheticConnectPartition(50, 2, true, false),
      false,
    )
    assert.equal(
      shouldEmitSyntheticConnectPartition(816, 2, true, true),
      false,
    )
  })

  it('resolves recent vps l4 ok from ledger rows', () => {
    const ok = resolveRecentVpsL4OkForNode(
      [
        {
          ts: new Date(NOW - 60_000).toISOString(),
          scope: 'vps',
          node: 'JP-VPS',
          method: 'ssh_curl',
          latency_ms: 518,
          ok: true,
        },
      ],
      'JP-VPS-HY2',
      NOW,
    )
    assert.equal(ok, true)
  })

  it('tracks latency delta rescue streak across MTDO cycles', () => {
    assert.equal(nextLatencyDeltaRescueStreak(0, true), 1)
    assert.equal(nextLatencyDeltaRescueStreak(1, true), 2)
    assert.equal(isLatencyDeltaRescueEligible(2), true)
    assert.equal(nextLatencyDeltaRescueStreak(2, false), 0)
  })

  it('tracks warmth defer streak and ultra conn observability', () => {
    assert.equal(nextWarmthDeferStreak(1, true), 2)
    assert.equal(nextWarmthDeferStreak(2, false), 0)
    assert.equal(shouldEmitUltraConnObservability(500), true)
    assert.equal(shouldEmitUltraConnObservability(199), false)
  })

  it('resolveConnectPartitionWindowMs widens at conn>=12 (60s P26) and conn>=200 (60s P16)', () => {
    assert.equal(resolveConnectPartitionWindowMs(11), 8_000)
    assert.equal(resolveConnectPartitionWindowMs(12), 60_000)
    assert.equal(resolveConnectPartitionWindowMs(199), 60_000)
    assert.equal(resolveConnectPartitionWindowMs(816), 60_000)
  })
})
