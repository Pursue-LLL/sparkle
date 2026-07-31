import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import {
  CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS,
  CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS,
  CURSOR_SEGMENT_HANDOFF_TARGET_MS,
  detectSegmentHandoffDue,
  isQuicStallHandoffTrigger,
  parseHttpSegmentStartedLine,
  parseSegmentTerminatedId,
  resolveEffectiveHandoffTargetMs,
} from './cursorSegmentHandoffCore'
import { buildMarathonStreamRegistry } from './marathonStreamRegistryCore'
import { mergeMarathonSegmentRecords } from './marathonSegmentCache'

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

  it('resolveEffectiveHandoffTargetMs lowers target when QUIC stall is active', () => {
    const effective = resolveEffectiveHandoffTargetMs(CURSOR_SEGMENT_HANDOFF_TARGET_MS, {
      maxStallMs: CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS + 1,
      frozenQuicCursorCount: 1,
    })
    assert.equal(effective, CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS)
  })

  it('detects handoff due early on QUIC stall when segment exceeds min age', () => {
    const segmentStartMs = NOW_MS - CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS - 60_000
    const segments = [
      {
        segmentId: 'seg-quic',
        requestId: 'req-quic',
        originalRequestId: 'orig-quic',
        composerId: 'comp-quic',
        actionCase: 'resumeAction',
        httpStartMs: segmentStartMs,
      },
    ]
    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'req-quic', activityMs: NOW_MS - 30_000 }],
      [],
      NOW_MS,
      6 * 60 * 60_000,
    )
    const due = detectSegmentHandoffDue(segments, new Set(), registry, {
      nowMs: NOW_MS,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      quicStallContext: {
        maxStallMs: 210_011,
        frozenQuicCursorCount: 1,
      },
    })
    assert.ok(due)
    assert.equal(due?.trigger, 'quic_stall')
    assert.equal(due?.segmentId, 'seg-quic')
    assert.ok(due!.segmentAgeMs >= CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS)
    assert.ok(due!.segmentAgeMs < CURSOR_SEGMENT_HANDOFF_TARGET_MS)
  })

  it('mergeMarathonSegmentRecords keeps cache segment when renderer tail rolled out', () => {
    const cacheOnly = mergeMarathonSegmentRecords(
      [
        {
          segmentId: 'seg-cache',
          requestId: 'req-cache',
          originalRequestId: 'orig-cache',
          composerId: 'comp-cache',
          actionCase: 'resumeAction',
          httpStartMs: HTTP_START_MS,
          recordedAtMs: HTTP_START_MS,
        },
      ],
      [],
    )
    assert.equal(cacheOnly.length, 1)
    assert.equal(cacheOnly[0]?.requestId, 'req-cache')
  })

  it('isQuicStallHandoffTrigger requires frozen cursor and stall threshold', () => {
    assert.equal(
      isQuicStallHandoffTrigger({
        maxStallMs: CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS,
        frozenQuicCursorCount: 1,
      }),
      true,
    )
    assert.equal(
      isQuicStallHandoffTrigger({
        maxStallMs: CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS - 1,
        frozenQuicCursorCount: 1,
      }),
      false,
    )
  })
})
