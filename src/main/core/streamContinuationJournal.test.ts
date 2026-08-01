import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import { reduceContinuationIntentEvents } from './p10ContinuationJournalCore'
import {
  appendStreamContinuationJournalEvents,
  readStreamContinuationJournalTail,
  setStreamContinuationJournalPathForTests,
} from './streamContinuationJournal'

describe('streamContinuationJournal P10-4', () => {
  it('persists and replays continuation intent events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p10-cont-journal-'))
    const journalPath = join(dir, 'journal.jsonl')
    setStreamContinuationJournalPathForTests(journalPath)
    try {
      appendStreamContinuationJournalEvents([
        {
          eventId: 'e1',
          sequence: 1,
          occurredAtMs: 100,
          composerId: 'c1',
          originalRequestId: 'o1',
          targetComposerId: 'c1',
          phase: 'pending',
        },
      ])
      const tail = readStreamContinuationJournalTail()
      assert.equal(tail.length, 1)
      const state = reduceContinuationIntentEvents(tail)
      assert.equal(state.get('c1|o1')?.phase, 'pending')
    } finally {
      setStreamContinuationJournalPathForTests(null)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
