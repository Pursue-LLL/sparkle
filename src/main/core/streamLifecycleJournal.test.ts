import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { appendStreamLifecycleJournalEvents,
  mergeStreamLifecycleJournalEvents,
  readStreamLifecycleJournalTail,
  readStreamLifecycleJournalTailText,
  setStreamLifecycleJournalPathForTests,
  STREAM_LIFECYCLE_JOURNAL_MAX_BYTES,
  STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES } from './streamLifecycleJournal'
import type { StreamLifecycleEvent } from './streamLifecycleTruthCore'

describe('streamLifecycleJournal P10-1', () => {
  it('appends and reads lifecycle events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-lifecycle-'))
    const journalPath = path.join(dir, 'stream-lifecycle-journal.v1.jsonl')
    setStreamLifecycleJournalPathForTests(journalPath)
    const event: StreamLifecycleEvent = {
      eventId: 'start:orig-1:1000',
      sequence: 1,
      occurredAtMs: 1000,
      rendererBootId: 'boot-a',
      composerId: 'comp-1',
      originalRequestId: 'orig-1',
      segmentRequestId: 'req-1',
      generation: 0,
      kind: 'physical_start',
    }
    appendStreamLifecycleJournalEvents([event])
    const tail = readStreamLifecycleJournalTail(8)
    assert.equal(tail.length, 1)
    assert.equal(tail[0]?.eventId, 'start:orig-1:1000')
    setStreamLifecycleJournalPathForTests(null)
  })

  it('readStreamLifecycleJournalTailText reads only trailing bytes for large files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-lifecycle-large-'))
    const journalPath = path.join(dir, 'stream-lifecycle-journal.v1.jsonl')
    const staleLine = JSON.stringify({
      eventId: 'start:stale:1',
      sequence: 1,
      occurredAtMs: 1,
      rendererBootId: 'boot-a',
      composerId: 'comp-1',
      originalRequestId: 'stale',
      segmentRequestId: 'req-stale',
      generation: 0,
      kind: 'physical_start',
    })
    const freshLine = JSON.stringify({
      eventId: 'start:fresh:2',
      sequence: 2,
      occurredAtMs: 2,
      rendererBootId: 'boot-a',
      composerId: 'comp-1',
      originalRequestId: 'fresh',
      segmentRequestId: 'req-fresh',
      generation: 0,
      kind: 'physical_start',
    })
    const padding = 'x'.repeat(STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES)
    fs.writeFileSync(journalPath, `${staleLine}\n${padding}\n${freshLine}\n`, 'utf8')
    const text = readStreamLifecycleJournalTailText(journalPath)
    assert.ok(!text.includes('stale'))
    assert.ok(text.includes('fresh'))
  })

  it('compacts journal on append when file exceeds max bytes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p10-lifecycle-compact-'))
    const journalPath = path.join(dir, 'stream-lifecycle-journal.v1.jsonl')
    const staleLine = JSON.stringify({
      eventId: 'start:stale:1',
      sequence: 1,
      occurredAtMs: 1,
      rendererBootId: 'boot-a',
      composerId: 'comp-1',
      originalRequestId: 'stale',
      segmentRequestId: 'req-stale',
      generation: 0,
      kind: 'physical_start',
    })
    const freshLine = JSON.stringify({
      eventId: 'start:fresh:2',
      sequence: 2,
      occurredAtMs: 2,
      rendererBootId: 'boot-a',
      composerId: 'comp-1',
      originalRequestId: 'fresh',
      segmentRequestId: 'req-fresh',
      generation: 0,
      kind: 'physical_start',
    })
    const padding = 'x'.repeat(STREAM_LIFECYCLE_JOURNAL_MAX_BYTES)
    fs.writeFileSync(journalPath, `${staleLine}\n${padding}\n${freshLine}\n`, 'utf8')
    setStreamLifecycleJournalPathForTests(journalPath)
    appendStreamLifecycleJournalEvents([
      {
        eventId: 'start:new:3',
        sequence: 3,
        occurredAtMs: 3,
        rendererBootId: 'boot-a',
        composerId: 'comp-1',
        originalRequestId: 'new',
        segmentRequestId: 'req-new',
        generation: 0,
        kind: 'physical_start',
      },
    ])
    assert.ok(fs.statSync(journalPath).size <= STREAM_LIFECYCLE_JOURNAL_MAX_BYTES)
    const text = fs.readFileSync(journalPath, 'utf8')
    assert.ok(!text.includes('stale'))
    assert.ok(text.includes('fresh'))
    assert.ok(text.includes('new'))
    setStreamLifecycleJournalPathForTests(null)
  })

  it('merges persisted and projected without duplicate eventId', () => {
    const persisted: StreamLifecycleEvent[] = [
      {
        eventId: 'start:orig-1:1000',
        sequence: 1,
        occurredAtMs: 1000,
        rendererBootId: 'boot-a',
        composerId: 'comp-1',
        originalRequestId: 'orig-1',
        segmentRequestId: 'req-1',
        generation: 0,
        kind: 'physical_start',
      },
    ]
    const projected: StreamLifecycleEvent[] = [
      ...persisted,
      {
        eventId: 'terminal:orig-1:5000',
        sequence: 2,
        occurredAtMs: 5000,
        rendererBootId: 'boot-a',
        composerId: 'comp-1',
        originalRequestId: 'orig-1',
        segmentRequestId: 'req-1',
        generation: 0,
        kind: 'terminal',
        terminalKind: 'server_eof',
      },
    ]
    const merged = mergeStreamLifecycleJournalEvents(persisted, projected)
    assert.equal(merged.length, 2)
    assert.equal(merged[1]?.kind, 'terminal')
  })
})
