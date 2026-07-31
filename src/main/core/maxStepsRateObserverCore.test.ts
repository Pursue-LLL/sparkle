import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTransportFailureRow } from './connectPartitionDetectCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import {
  computeMaxStepsRateSnapshot,
  isMaxStepsTerminalRow,
  MAX_STEPS_RATE_TARGET_PCT,
} from './maxStepsRateObserverCore'

const nowMs = 1_700_000_000_000

function segment(
  partial: Partial<MarathonSegmentCacheRecord> & Pick<MarathonSegmentCacheRecord, 'originalRequestId'>,
): MarathonSegmentCacheRecord {
  return {
    segmentId: partial.segmentId ?? `seg-${partial.originalRequestId}`,
    requestId: partial.requestId ?? partial.originalRequestId,
    originalRequestId: partial.originalRequestId,
    composerId: partial.composerId ?? 'composer-1',
    actionCase: partial.actionCase ?? 'userMessage',
    httpStartMs: partial.httpStartMs ?? nowMs - 60_000,
    recordedAtMs: partial.recordedAtMs ?? nowMs - 60_000,
  }
}

test('isMaxStepsTerminalRow detects reasonSub and errMsg', () => {
  assert.equal(isMaxStepsTerminalRow({ ts: nowMs, reasonSub: 'max-steps-cap' }), true)
  assert.equal(
    isMaxStepsTerminalRow({
      ts: nowMs,
      errMsg: 'Reached maximum number of steps before turn ended',
    }),
    true,
  )
  assert.equal(isMaxStepsTerminalRow({ ts: nowMs, reasonSub: 'server-eof' }), false)
})

test('computeMaxStepsRateSnapshot counts started turns and max-steps rate', () => {
  const segments: MarathonSegmentCacheRecord[] = [
    segment({ originalRequestId: 'turn-a' }),
    segment({ originalRequestId: 'turn-b' }),
    segment({
      originalRequestId: 'turn-b',
      requestId: 'resume-b',
      actionCase: 'resumeAction',
      httpStartMs: nowMs - 30_000,
    }),
    segment({ originalRequestId: 'turn-c' }),
  ]
  const failures: AgentTransportFailureRow[] = [
    {
      ts: nowMs - 10_000,
      originalRequestId: 'turn-a',
      reasonSub: 'max-steps-cap',
      errMsg: 'Reached maximum number of steps',
    },
    {
      ts: nowMs - 5_000,
      originalRequestId: 'turn-b',
      reasonSub: 'server-eof',
      errMsg: 'Stream ended',
    },
  ]

  const snapshot = computeMaxStepsRateSnapshot(segments, failures, nowMs, 86_400_000)
  assert.equal(snapshot.startedTurns, 3)
  assert.equal(snapshot.completedTurns, 2)
  assert.equal(snapshot.maxStepsTurns, 1)
  assert.equal(snapshot.earlyDisconnectTurns, 1)
  assert.equal(snapshot.inProgressTurns, 1)
  assert.equal(snapshot.maxStepsRatePct, 33.3)
  assert.equal(snapshot.belowTarget, true)
  assert.equal(snapshot.targetPct, MAX_STEPS_RATE_TARGET_PCT)
})
