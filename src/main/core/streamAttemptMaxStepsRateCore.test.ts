import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import {
  buildStreamAttemptKey,
  computeStreamAttemptMaxStepsRateSnapshot,
} from './streamAttemptMaxStepsRateCore'

const nowMs = 1_700_000_000_000

test('buildStreamAttemptKey prefers requestId for reconnect attempts', () => {
  assert.equal(
    buildStreamAttemptKey({
      originalRequestId: 'turn-1',
      requestId: 'resume-2',
      attempt: 2,
    }),
    'req:resume-2',
  )
  assert.equal(
    buildStreamAttemptKey({
      originalRequestId: 'turn-1',
      attempt: 2,
    }),
    'turn:turn-1:2',
  )
})

test('computeStreamAttemptMaxStepsRateSnapshot counts reconnect attempts separately', () => {
  const ledgerRows = [
    {
      ts: nowMs - 20_000,
      originalRequestId: 'turn-a',
      requestId: 'turn-a',
      attempt: 0,
      isMaxSteps: false,
      reason: 'Stream ended',
      streamPrimarySub: 'server-eof',
    },
    {
      ts: nowMs - 10_000,
      originalRequestId: 'turn-a',
      requestId: 'resume-a-1',
      attempt: 1,
      isMaxSteps: true,
      reason: 'Reached maximum number of steps',
    },
  ]
  const snapshot = computeStreamAttemptMaxStepsRateSnapshot(ledgerRows, [], [], nowMs)
  assert.equal(snapshot.primary.startedAttempts, 2)
  assert.equal(snapshot.primary.completedAttempts, 2)
  assert.equal(snapshot.primary.maxStepsAttempts, 1)
  assert.equal(snapshot.primary.earlyDisconnectAttempts, 1)
  assert.equal(snapshot.primary.attemptRatePct, 50)
  assert.equal(snapshot.belowTarget, true)
})

test('computeStreamAttemptMaxStepsRateSnapshot includes in-progress segment attempts', () => {
  const segments: MarathonSegmentCacheRecord[] = [
    {
      segmentId: 'seg-live',
      requestId: 'live-req',
      originalRequestId: 'turn-live',
      composerId: 'composer-1',
      actionCase: 'resumeAction',
      httpStartMs: nowMs - 5_000,
      recordedAtMs: nowMs - 5_000,
    },
  ]
  const snapshot = computeStreamAttemptMaxStepsRateSnapshot([], [], segments, nowMs)
  assert.equal(snapshot.primary.startedAttempts, 1)
  assert.equal(snapshot.primary.inProgressAttempts, 1)
  assert.equal(snapshot.primary.completedAttempts, 0)
})

test('computeStreamAttemptMaxStepsRateSnapshot prefers ledger max-steps over jsonl server-eof', () => {
  const jsonlRows: AgentTransportFailureRow[] = [
    {
      ts: nowMs - 10_000,
      originalRequestId: 'turn-x',
      requestId: 'turn-x',
      reasonSub: 'server-eof',
      errMsg: 'Stream ended',
    },
  ]
  const ledgerRows = [
    {
      ts: nowMs - 9_000,
      originalRequestId: 'turn-x',
      requestId: 'turn-x',
      isMaxSteps: true,
      reason: 'Reached maximum number of steps',
    },
  ]
  const snapshot = computeStreamAttemptMaxStepsRateSnapshot(ledgerRows, jsonlRows, [], nowMs)
  assert.equal(snapshot.primary.maxStepsAttempts, 1)
  assert.equal(snapshot.primary.earlyDisconnectAttempts, 0)
  assert.equal(snapshot.primary.attemptRatePct, 100)
})
