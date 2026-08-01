import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  appendStreamLifecycleJournalEvents,
  mergeStreamLifecycleJournalEvents,
  readStreamLifecycleJournalTail,
  setStreamLifecycleJournalPathForTests,
} from './streamLifecycleJournal'
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
