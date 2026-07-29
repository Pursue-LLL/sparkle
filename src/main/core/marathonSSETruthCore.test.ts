import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { HttpSegmentStartedSample } from './cursorSegmentHandoffCore'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import {
  collectSegmentsFromIfmLines,
  evaluateMarathonSSETruth,
  isPulseContractBreach,
  shouldRunPulseContract,
} from './marathonSSETruthCore'
import { MTDO_CONNECT_PATH_PULSE_INTERVAL_MS, MTDO_MARATHON_STREAM_MIN_AGE_MS } from './marathonTransportDialOrchestratorCore'
import { buildMarathonStreamRegistry } from './marathonStreamRegistryCore'

describe('marathonSSETruthCore', () => {
  it('BUG-026: parent chain age >=30min triggers pulse even when registry tail would say inactive', () => {
    const nowMs = 10_000_000
    const chainStartMs = nowMs - MTDO_MARATHON_STREAM_MIN_AGE_MS - 60_000
    const segments: HttpSegmentStartedSample[] = [
      {
        segmentId: 'seg-1',
        requestId: 'resume-rid',
        originalRequestId: 'parent-rid',
        composerId: 'composer-1',
        actionCase: 'resumeAction',
        httpStartMs: nowMs - 120_000,
      },
      {
        segmentId: 'seg-0',
        requestId: 'parent-rid',
        originalRequestId: 'parent-rid',
        composerId: 'composer-1',
        actionCase: 'userMessageAction',
        httpStartMs: chainStartMs,
      },
    ]
    const registry = buildMarathonStreamRegistry([], [], nowMs)
    const truth = evaluateMarathonSSETruth({
      nowMs,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      segments,
      terminatedSegmentIds: new Set(['seg-0']),
      registry,
      lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS - 1,
    })
    assert.equal(truth.pulseContractDue, true)
    assert.ok(truth.maxParentChainAgeMs >= MTDO_MARATHON_STREAM_MIN_AGE_MS)
    assert.equal(
      shouldRunPulseContract(
        truth,
        CURSOR_HY2_MARATHON_CONN_THRESHOLD,
        nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS - 1,
        nowMs,
      ),
      true,
    )
  })

  it('detects pulse contract breach when overdue', () => {
    const nowMs = 20_000_000
    const truth = evaluateMarathonSSETruth({
      nowMs,
      cursorConnectionCount: 20,
      segments: [
        {
          segmentId: 'seg-a',
          requestId: 'rid-a',
          originalRequestId: 'parent-a',
          composerId: 'c1',
          actionCase: 'userMessageAction',
          httpStartMs: nowMs - MTDO_MARATHON_STREAM_MIN_AGE_MS - 5_000,
        },
      ],
      terminatedSegmentIds: new Set<string>(),
      registry: buildMarathonStreamRegistry([], [], nowMs),
      lastConnectPathPulseAtMs: nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS - 10_000,
    })
    assert.equal(truth.pulseContractDue, true)
    assert.equal(
      isPulseContractBreach(truth, nowMs - MTDO_CONNECT_PATH_PULSE_INTERVAL_MS - 10_000, nowMs),
      true,
    )
  })

  it('does not require pulse before parent chain reaches min age', () => {
    const nowMs = 30_000_000
    const truth = evaluateMarathonSSETruth({
      nowMs,
      cursorConnectionCount: 20,
      segments: [
        {
          segmentId: 'seg-new',
          requestId: 'rid-new',
          originalRequestId: 'parent-new',
          composerId: 'c1',
          actionCase: 'userMessageAction',
          httpStartMs: nowMs - 600_000,
        },
      ],
      terminatedSegmentIds: new Set<string>(),
      registry: buildMarathonStreamRegistry([], [], nowMs),
      lastConnectPathPulseAtMs: 0,
    })
    assert.equal(truth.pulseContractDue, false)
  })

  it('excludes terminated segments from open segment count', () => {
    const nowMs = 40_000_000
    const chainStartMs = nowMs - MTDO_MARATHON_STREAM_MIN_AGE_MS - 1_000
    const truth = evaluateMarathonSSETruth({
      nowMs,
      cursorConnectionCount: 20,
      segments: [
        {
          segmentId: 'seg-closed',
          requestId: 'rid-a',
          originalRequestId: 'parent-a',
          composerId: 'c1',
          actionCase: 'userMessageAction',
          httpStartMs: chainStartMs,
        },
      ],
      terminatedSegmentIds: new Set(['seg-closed']),
      registry: buildMarathonStreamRegistry([], [], nowMs),
      lastConnectPathPulseAtMs: 0,
    })
    assert.equal(truth.openSegmentCount, 0)
    assert.equal(truth.pulseContractDue, false)
  })

  it('collectSegmentsFromIfmLines merges started and terminated ids', () => {
    const parentRid = 'parent-rid'
    const lines = [
      `[ifm-event-v1] {"eventKind":"http_segment_started","requestId":"resume-rid","originalRequestId":"${parentRid}","payload":{"segmentId":"seg-resume","httpStartMs":9000000}}`,
      `[ifm-event-v1] {"eventKind":"http_segment_started","requestId":"${parentRid}","originalRequestId":"${parentRid}","payload":{"segmentId":"seg-parent","httpStartMs":1000000}}`,
      `[ifm-event-v1] {"eventKind":"stream_terminated","payload":{"segmentId":"seg-parent"}}`,
    ]
    const { segments, terminatedSegmentIds } = collectSegmentsFromIfmLines(lines)
    assert.equal(segments.length, 2)
    assert.equal(terminatedSegmentIds.has('seg-parent'), true)
    const openParent = segments.filter((s) => s.originalRequestId === parentRid && !terminatedSegmentIds.has(s.segmentId))
    assert.equal(openParent.length, 1)
    assert.equal(openParent[0]?.segmentId, 'seg-resume')
  })
})
