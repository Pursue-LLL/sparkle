import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatPartitionBlindSpotLogLine,
  shouldEmitPartitionBlindSpot,
  PARTITION_BLIND_SPOT_COOLDOWN_MS,
} from './partitionBlindSpotCore'

describe('partitionBlindSpotCore', () => {
  it('emits blind spot when structured>=2 and jsonl=0 at conn>=12', () => {
    assert.equal(
      shouldEmitPartitionBlindSpot({
        cursorConnectionCount: 436,
        structuredPingCount: 2,
        jsonlPingCount: 0,
        nowMs: 1_000_000,
        lastEmittedAtMs: 0,
      }),
      true,
    )
  })

  it('suppresses when jsonl already has ping rows', () => {
    assert.equal(
      shouldEmitPartitionBlindSpot({
        cursorConnectionCount: 436,
        structuredPingCount: 2,
        jsonlPingCount: 1,
        nowMs: 1_000_000,
        lastEmittedAtMs: 0,
      }),
      false,
    )
  })

  it('respects cooldown', () => {
    const nowMs = 1_000_000
    assert.equal(
      shouldEmitPartitionBlindSpot({
        cursorConnectionCount: 436,
        structuredPingCount: 2,
        jsonlPingCount: 0,
        nowMs,
        lastEmittedAtMs: nowMs - PARTITION_BLIND_SPOT_COOLDOWN_MS + 1,
      }),
      false,
    )
  })

  it('formats blind spot line with sample rids', () => {
    const line = formatPartitionBlindSpotLogLine({
      structuredPingCount: 2,
      jsonlPingCount: 0,
      cursorConnectionCount: 436,
      logRoots: 1,
      structuredFiles: 1,
      mergedRows: 2,
      dedupedRows: 2,
      partitionDetected: true,
      sampleRequestIds: ['520a4a94-3f18-4e42-a5dd-d7abbd25ed9d'],
    })
    assert.match(line, /\[PartitionBlindSpot\]/)
    assert.match(line, /520a4a94/)
  })
})
