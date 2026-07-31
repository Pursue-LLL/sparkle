import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MARATHON_TOKEN_GAP_SNAPSHOT_RETENTION_MS,
  resolveMarathonTokenGapRecoverySnapshot,
} from './marathonTokenGapSnapshotRetentionCore'

describe('marathonTokenGapSnapshotRetentionCore R-34e', () => {
  const staleSnapshot = { maxGapMs: 3_200_000, staleRequestIdCount: 3 }

  it('uses fresh snapshot when stale proof is present', () => {
    const resolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: staleSnapshot,
      marathonTruthActive: true,
      retained: { maxGapMs: 0, staleRequestIdCount: 0 },
      retainedAtMs: 0,
      nowMs: 1_000_000,
    })
    assert.equal(resolution.source, 'fresh')
    assert.equal(resolution.snapshot.maxGapMs, 3_200_000)
    assert.equal(resolution.retainedAtMs, 1_000_000)
  })

  it('retains prior stale proof when fresh read is absent during marathon', () => {
    const resolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: null,
      marathonTruthActive: true,
      retained: staleSnapshot,
      retainedAtMs: 1_000_000 - 60_000,
      nowMs: 1_000_000,
    })
    assert.equal(resolution.source, 'retained')
    assert.equal(resolution.snapshot.staleRequestIdCount, 3)
    assert.equal(resolution.retainedAtMs, 1_000_000 - 60_000)
  })

  it('clears when marathon inactive even if retention window has not expired', () => {
    const resolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: null,
      marathonTruthActive: false,
      retained: staleSnapshot,
      retainedAtMs: 1_000_000 - 30_000,
      nowMs: 1_000_000,
    })
    assert.equal(resolution.source, 'cleared')
    assert.equal(resolution.snapshot.maxGapMs, 0)
    assert.equal(resolution.retainedAtMs, 0)
  })

  it('clears when retention TTL expires', () => {
    const resolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: null,
      marathonTruthActive: true,
      retained: staleSnapshot,
      retainedAtMs: 1_000_000 - MARATHON_TOKEN_GAP_SNAPSHOT_RETENTION_MS - 1,
      nowMs: 1_000_000,
    })
    assert.equal(resolution.source, 'cleared')
  })

  it('clears when fresh read shows recovery (no stale proof)', () => {
    const resolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: { maxGapMs: 0, staleRequestIdCount: 0 },
      marathonTruthActive: true,
      retained: staleSnapshot,
      retainedAtMs: 1_000_000 - 30_000,
      nowMs: 1_000_000,
    })
    assert.equal(resolution.source, 'cleared')
  })
})
