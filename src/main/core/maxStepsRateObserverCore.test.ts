import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentTransportFailureRow } from './agentTransportFailureWriterCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import {
  computeMaxStepsRateSnapshot,
  isMaxStepsTerminalRow,
  isResourceExhaustedTerminalRow,
  MAX_STEPS_RATE_TARGET_PCT,
} from './maxStepsRateObserverCore'

const nowMs = 1_700_000_000_000

function segment(
  partial: Partial<MarathonSegmentCacheRecord> & Pick<MarathonSegmentCacheRecord, 'originalRequestId'>,
  offsetMs = 0,
): MarathonSegmentCacheRecord {
  return {
    segmentId: partial.segmentId ?? `seg-${partial.originalRequestId}`,
    requestId: partial.requestId ?? partial.originalRequestId,
    originalRequestId: partial.originalRequestId,
    composerId: partial.composerId ?? 'composer-1',
    actionCase: partial.actionCase ?? 'userMessage',
    httpStartMs: partial.httpStartMs ?? nowMs - 60_000 - offsetMs,
    recordedAtMs: partial.recordedAtMs ?? nowMs - 60_000 - offsetMs,
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

test('isResourceExhaustedTerminalRow detects transport mislabel without counting max-steps', () => {
  assert.equal(
    isResourceExhaustedTerminalRow({ ts: nowMs, errMsg: '[resource_exhausted] Error' }),
    true,
  )
  assert.equal(
    isResourceExhaustedTerminalRow({ ts: nowMs, reasonSub: 'resource-exhausted' }),
    true,
  )
  assert.equal(
    isResourceExhaustedTerminalRow({
      ts: nowMs,
      reasonSub: 'max-steps-cap',
      errMsg: 'Reached maximum number of steps',
    }),
    false,
  )
})

test('computeMaxStepsRateSnapshot uses rolling100 primary and 24h aux', () => {
  const segments: MarathonSegmentCacheRecord[] = [
    segment({ originalRequestId: 'turn-a' }),
    segment({ originalRequestId: 'turn-b' }),
    segment({
      originalRequestId: 'turn-b',
      requestId: 'resume-b',
      actionCase: 'resumeAction',
      httpStartMs: nowMs - 30_000,
    }),
    segment({ originalRequestId: 'turn-c' }, 86_500_000),
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
    {
      ts: nowMs - 3_000,
      originalRequestId: 'turn-d',
      reasonSub: 'resource-exhausted',
      errMsg: '[resource_exhausted] Error',
    },
  ]

  const segmentsWithD = [
    ...segments,
    segment({ originalRequestId: 'turn-d' }),
  ]

  const snapshot = computeMaxStepsRateSnapshot(segmentsWithD, failures, nowMs)
  assert.equal(snapshot.primary.windowLabel, 'rolling100')
  assert.equal(snapshot.primary.startedTurns, 4)
  assert.equal(snapshot.primary.completedTurns, 3)
  assert.equal(snapshot.primary.maxStepsTurns, 1)
  assert.equal(snapshot.primary.resourceExhaustedTurns, 1)
  assert.equal(snapshot.primary.earlyDisconnectTurns, 2)
  assert.equal(snapshot.primary.inProgressTurns, 1)
  assert.equal(snapshot.primary.maxStepsRatePct, 25)
  assert.equal(snapshot.primary.resourceExhaustedRatePct, 25)
  assert.equal(snapshot.aux24h.startedTurns, 3)
  assert.equal(snapshot.aux24h.maxStepsTurns, 1)
  assert.equal(snapshot.aux24h.resourceExhaustedTurns, 1)
  assert.equal(snapshot.belowTarget, true)
  assert.equal(snapshot.targetPct, MAX_STEPS_RATE_TARGET_PCT)
  assert.equal(snapshot.ledgerTerminalCount, 0)
})

test('computeMaxStepsRateSnapshot counts ledger max-steps when jsonl only has server-eof', () => {
  const segments: MarathonSegmentCacheRecord[] = [
    segment({ originalRequestId: 'turn-ledger' }),
  ]
  const failures: AgentTransportFailureRow[] = [
    {
      ts: nowMs - 5_000,
      originalRequestId: 'turn-ledger',
      reasonSub: 'server-eof',
      errMsg: 'Stream ended',
    },
  ]
  const ledgerRows = [
    {
      ts: nowMs - 4_000,
      originalRequestId: 'turn-ledger',
      isMaxSteps: true,
      reason: 'Reached maximum number of steps',
      willRetry: false,
    },
  ]
  const snapshot = computeMaxStepsRateSnapshot(segments, failures, nowMs, undefined, undefined, undefined, ledgerRows)
  assert.equal(snapshot.primary.maxStepsTurns, 1)
  assert.equal(snapshot.primary.earlyDisconnectTurns, 0)
  assert.equal(snapshot.ledgerMaxStepsInPrimary, 1)
})

test('rolling100 selects most recent turn starts only', () => {
  const segments: MarathonSegmentCacheRecord[] = []
  for (let i = 0; i < 105; i += 1) {
    segments.push(segment({ originalRequestId: `turn-${i}` }, i * 60_000))
  }
  const snapshot = computeMaxStepsRateSnapshot(segments, [], nowMs)
  assert.equal(snapshot.primary.startedTurns, 100)
  assert.equal(snapshot.primary.inProgressTurns, 100)
})
