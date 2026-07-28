import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import {
  CURSOR_SEGMENT_HANDOFF_TARGET_MS,
  detectSegmentHandoffDue,
  parseHttpSegmentStartedLine,
  parseSegmentTerminatedId,
} from './cursorSegmentHandoffCore'
import { buildMarathonStreamRegistry } from './marathonStreamRegistryCore'

const HTTP_START_MS = 1_000_000
const NOW_MS = HTTP_START_MS + CURSOR_SEGMENT_HANDOFF_TARGET_MS + 60_000

describe('cursorSegmentHandoffCore', () => {
  it('parses http_segment_started from ifm-event-v1', () => {
    const line =
      '[ifm-event-v1] {"schemaVersion":1,"eventKind":"http_segment_started","requestId":"req-1","originalRequestId":"orig-1","composerId":"comp-1","actionCase":"resumeAction","payload":{"segmentId":"seg-14","httpStartMs":1000000}}'
    const sample = parseHttpSegmentStartedLine(line)
    assert.ok(sample)
    assert.equal(sample?.segmentId, 'seg-14')
    assert.equal(sample?.requestId, 'req-1')
    assert.equal(sample?.originalRequestId, 'orig-1')
    assert.equal(sample?.actionCase, 'resumeAction')
  })

  it('parses stream_terminated segmentId', () => {
    const line =
      '[ifm-event-v1] {"eventKind":"stream_terminated","payload":{"segmentId":"seg-done","reason":"generation-ended-without-turnEnded"}}'
    assert.equal(parseSegmentTerminatedId(line), 'seg-done')
  })

  it('detects handoff due at 85min with pendingTool=0 and recent activity', () => {
    const segments = [
      {
        segmentId: 'seg-14',
        requestId: 'req-1',
        originalRequestId: 'orig-1',
        composerId: 'comp-1',
        actionCase: 'resumeAction',
        httpStartMs: HTTP_START_MS,
      },
    ]
    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'req-1', activityMs: NOW_MS - 30_000 }],
      [],
      NOW_MS,
      6 * 60 * 60_000,
    )
    const due = detectSegmentHandoffDue(segments, new Set(), registry, {
      nowMs: NOW_MS,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
    })
    assert.ok(due)
    assert.equal(due?.segmentId, 'seg-14')
    assert.ok(due!.segmentAgeMs >= CURSOR_SEGMENT_HANDOFF_TARGET_MS)
    assert.equal(due?.pendingToolCalls, 0)
  })

  it('skips terminated segments', () => {
    const segments = [
      {
        segmentId: 'seg-14',
        requestId: 'req-1',
        originalRequestId: 'orig-1',
        composerId: 'comp-1',
        actionCase: 'resumeAction',
        httpStartMs: HTTP_START_MS,
      },
    ]
    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'req-1', activityMs: NOW_MS - 30_000 }],
      [],
      NOW_MS,
      6 * 60 * 60_000,
    )
    const due = detectSegmentHandoffDue(segments, new Set(['seg-14']), registry, {
      nowMs: NOW_MS,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
    })
    assert.equal(due, undefined)
  })

  it('skips when open tool calls remain', () => {
    const segments = [
      {
        segmentId: 'seg-14',
        requestId: 'req-1',
        originalRequestId: 'orig-1',
        composerId: 'comp-1',
        actionCase: 'resumeAction',
        httpStartMs: HTTP_START_MS,
      },
    ]
    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'req-1', activityMs: NOW_MS - 30_000 }],
      [
        '2026-07-28 14:00:00.000 [info] [ifm-patch-19] SSE audit msgCase=toolCallStarted ts=' +
          String(NOW_MS - 20_000) +
          ' txReqId=req-1',
      ],
      NOW_MS,
      6 * 60 * 60_000,
    )
    const due = detectSegmentHandoffDue(segments, new Set(), registry, {
      nowMs: NOW_MS,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
    })
    assert.equal(due, undefined)
  })
})
