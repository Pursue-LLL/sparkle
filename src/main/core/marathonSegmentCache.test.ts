import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it } from 'node:test'
import type { HttpSegmentStartedSample } from './cursorSegmentHandoffCore'
import {
  MARATHON_SEGMENT_CACHE_MAX_AGE_MS,
  MARATHON_SEGMENT_CACHE_READ_TAIL_BYTES,
  mergeMarathonSegmentRecords,
  parseMarathonSegmentCacheLine,
  readMarathonSegmentCacheText,
  segmentSampleToCacheRecord,
} from './marathonSegmentCache'
import { MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'

describe('marathonSegmentCache', () => {
  it('parseMarathonSegmentCacheLine rejects invalid rows', () => {
    assert.equal(parseMarathonSegmentCacheLine(''), undefined)
    assert.equal(parseMarathonSegmentCacheLine('not-json'), undefined)
    assert.equal(parseMarathonSegmentCacheLine('{"segmentId":"","requestId":"r","httpStartMs":1}'), undefined)
  })

  it('segmentSampleToCacheRecord preserves parent chain fields', () => {
    const sample: HttpSegmentStartedSample = {
      segmentId: 'seg-1',
      requestId: 'resume-rid',
      originalRequestId: 'parent-rid',
      composerId: 'composer-1',
      actionCase: 'resumeAction',
      httpStartMs: 1_000_000,
    }
    const record = segmentSampleToCacheRecord(sample, 2_000_000)
    assert.equal(record.originalRequestId, 'parent-rid')
    assert.equal(record.httpStartMs, 1_000_000)
  })

  it('mergeMarathonSegmentRecords prefers newer httpStartMs per segmentId', () => {
    const merged = mergeMarathonSegmentRecords(
      [
        {
          segmentId: 'seg-a',
          requestId: 'rid-a',
          originalRequestId: 'parent-a',
          composerId: 'c1',
          actionCase: 'userMessageAction',
          httpStartMs: 100,
          recordedAtMs: 100,
        },
      ],
      [
        {
          segmentId: 'seg-a',
          requestId: 'rid-a',
          originalRequestId: 'parent-a',
          composerId: 'c1',
          actionCase: 'resumeAction',
          httpStartMs: 200,
        },
      ],
    )
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.httpStartMs, 200)
    assert.equal(merged[0]?.actionCase, 'resumeAction')
  })

  it('readMarathonSegmentCacheText reads only trailing bytes for large files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sparkle-seg-cache-'))
    try {
      const path = join(dir, 'marathon-segments.v1.jsonl')
      const staleLine = JSON.stringify({
        segmentId: 'stale-seg',
        requestId: 'stale-rid',
        originalRequestId: 'stale-parent',
        composerId: 'c1',
        actionCase: 'userMessageAction',
        httpStartMs: 1,
        recordedAtMs: 1,
      })
      const freshLine = JSON.stringify({
        segmentId: 'fresh-seg',
        requestId: 'fresh-rid',
        originalRequestId: 'fresh-parent',
        composerId: 'c1',
        actionCase: 'userMessageAction',
        httpStartMs: Date.now() - MTDO_MARATHON_STREAM_MIN_AGE_MS,
        recordedAtMs: Date.now(),
      })
      const padding = 'x'.repeat(MARATHON_SEGMENT_CACHE_READ_TAIL_BYTES)
      await writeFile(path, `${staleLine}\n${padding}\n${freshLine}\n`, 'utf8')
      const text = await readMarathonSegmentCacheText(path)
      assert.ok(!text.includes('stale-seg'))
      assert.ok(text.includes('fresh-seg'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('MARATHON_SEGMENT_CACHE_MAX_AGE_MS covers full marathon day', () => {
    assert.equal(MARATHON_SEGMENT_CACHE_MAX_AGE_MS, 86_400_000)
  })
})
