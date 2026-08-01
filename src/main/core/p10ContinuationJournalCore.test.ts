import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listPendingContinuationIntents,
  reduceContinuationIntentEvents,
  validateContinuationAckTransition,
} from './p10ContinuationJournalCore'

describe('p10ContinuationJournalCore P10-4', () => {
  it('replays pending intent until acknowledged', () => {
    const state = reduceContinuationIntentEvents([
      {
        eventId: 'i1',
        sequence: 1,
        occurredAtMs: 100,
        composerId: 'comp-a',
        originalRequestId: 'orig-1',
        targetComposerId: 'comp-a',
        phase: 'pending',
      },
      {
        eventId: 'i2',
        sequence: 2,
        occurredAtMs: 200,
        composerId: 'comp-a',
        originalRequestId: 'orig-1',
        targetComposerId: 'comp-a',
        phase: 'acknowledged',
        ackSource: 'resume_current_chat',
      },
    ])
    assert.equal(listPendingContinuationIntents(state).length, 0)
    assert.equal(state.get('comp-a|orig-1')?.phase, 'acknowledged')
  })

  it('rejects ack transition from failed intent', () => {
    const verdict = validateContinuationAckTransition({
      prev: {
        intentId: 'x',
        composerId: 'c',
        originalRequestId: 'o',
        targetComposerId: 'c',
        phase: 'failed',
        createdAtMs: 1,
        updatedAtMs: 2,
      },
      nextPhase: 'acknowledged',
    })
    assert.equal(verdict.ok, false)
  })
})
