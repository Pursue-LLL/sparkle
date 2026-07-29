import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import { MTDO_CONNECT_PATH_PULSE_INTERVAL_MS, MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'
import { buildMarathonSSETruthSnapshotFromParts } from './marathonSSETruthRuntime'

describe('marathonSSETruthRuntime', () => {
  it('merges cache parent segment with resume tail for pulse contract', () => {
    const nowMs = 80_000_000
    const parentStartMs = nowMs - MTDO_MARATHON_STREAM_MIN_AGE_MS - 120_000
    const parentRid = '445ba497-6c23-48e5-b47b-b88555993a4d'
    const built = buildMarathonSSETruthSnapshotFromParts({
      nowMs,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS - 1,
      activitySamples: [],
      toolLines: [],
      ifmSegmentLines: [
        `[ifm-event-v1] {"eventKind":"http_segment_started","requestId":"c3400bd9-resume","originalRequestId":"${parentRid}","payload":{"segmentId":"seg-resume","httpStartMs":${nowMs - 600_000}}}`,
      ],
      cacheRecords: [
        {
          segmentId: 'seg-parent',
          requestId: parentRid,
          originalRequestId: parentRid,
          composerId: 'composer-1',
          actionCase: 'userMessageAction',
          httpStartMs: parentStartMs,
          recordedAtMs: parentStartMs,
        },
      ],
    })
    assert.equal(built.truth.pulseContractDue, true)
    assert.ok(built.truth.maxParentChainAgeMs >= MTDO_MARATHON_STREAM_MIN_AGE_MS)
    assert.equal(built.mergedSegments.length, 2)
  })
})
