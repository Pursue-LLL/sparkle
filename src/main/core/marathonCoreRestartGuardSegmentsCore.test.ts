import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countRecentMarathonUserMessageSegments } from './marathonCoreRestartGuardSegmentsCore'

describe('marathonCoreRestartGuardSegmentsCore P10b', () => {
  it('counts userMessageAction within lookback', () => {
    const nowMs = 1_000_000
    const count = countRecentMarathonUserMessageSegments({
      nowMs,
      lookbackMs: 30 * 60 * 1000,
      records: [
        {
          segmentId: 's1',
          requestId: 'r1',
          originalRequestId: 'r1',
          composerId: 'c1',
          actionCase: 'userMessageAction',
          httpStartMs: nowMs - 60_000,
          recordedAtMs: nowMs - 60_000,
        },
        {
          segmentId: 's2',
          requestId: 'r2',
          originalRequestId: 'r2',
          composerId: 'c2',
          actionCase: 'resumeAction',
          httpStartMs: nowMs - 60_000,
          recordedAtMs: nowMs - 60_000,
        },
      ],
    })
    assert.equal(count, 1)
  })
})
