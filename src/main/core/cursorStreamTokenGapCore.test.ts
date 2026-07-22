import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_TOKEN_GAP_FORCE_MS,
} from './cursorHy2MarathonKeepaliveCore'
import {
  detectMarathonStreamTokenGap,
  detectMarathonColdResumeNoToken,
  parseColdResumeNoFirstTokenLine,
  parseRendererStreamActivityLine,
} from './cursorStreamTokenGapCore'

describe('cursorStreamTokenGapCore', () => {
  it('parses ifm-event-v1 stream_activity and ignores heartbeat', () => {
    const line =
      '[ifm-event-v1] {"schemaVersion":1,"eventKind":"stream_activity","occurredAtMs":1784631073057,"requestId":"d56b1442-dd91-404e-90c7-6bb49aa57d49","payload":{"activityKind":"textDelta","activityMs":1784631073057}}'
    const sample = parseRendererStreamActivityLine(line)
    assert.ok(sample)
    assert.equal(sample?.requestId, 'd56b1442-dd91-404e-90c7-6bb49aa57d49')
    assert.equal(sample?.activityMs, 1784631073057)

    const heartbeatLine =
      '[ifm-event-v1] {"schemaVersion":1,"eventKind":"stream_activity","occurredAtMs":1784631069918,"requestId":"rid-hb","payload":{"activityKind":"heartbeat","activityMs":1784631069918}}'
    assert.equal(parseRendererStreamActivityLine(heartbeatLine), undefined)
  })

  it('parses SSE audit tokenDelta with txReqId', () => {
    const line =
      '2026-07-21 18:53:47.023 [info] [ifm-patch-19] SSE audit msgCase=tokenDelta ts=1784631228023 txReqId=d56b1442-dd91-404e-90c7-6bb49aa57d49 lastSseN=239'
    const sample = parseRendererStreamActivityLine(line)
    assert.ok(sample)
    assert.equal(sample?.requestId, 'd56b1442-dd91-404e-90c7-6bb49aa57d49')
    assert.equal(sample?.activityMs, 1784631228023)
  })

  it('detects marathon token gap before server EOF window', () => {
    const lastActivityMs = 1_784_631_228_023
    const nowMs = lastActivityMs + CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1_000
    const signal = detectMarathonStreamTokenGap(
      [{ requestId: 'd56b1442-dd91-404e-90c7-6bb49aa57d49', activityMs: lastActivityMs }],
      {
        nowMs,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      },
    )
    assert.ok(signal)
    assert.ok(signal!.maxGapMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS)
    assert.deepEqual(signal!.staleRequestIds, ['d56b1442-dd91-404e-90c7-6bb49aa57d49'])
  })

  it('returns undefined below marathon conn threshold', () => {
    const signal = detectMarathonStreamTokenGap(
      [{ requestId: 'rid-1', activityMs: 1_000 }],
      {
        nowMs: 30_000,
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD - 1,
      },
    )
    assert.equal(signal, undefined)
  })

  it('parses cold resume no-first-token structured log line at 32s', () => {
    const line =
      '2026-07-22 13:22:26.273 [warning] {"level":"warn","key":"composer","message":"No first token received within 32s","metadata":{"requestId":"03054d22-feb3-4a3b-aaef-a3e5ec51661e","thresholdMs":"32000"}}'
    const sample = parseColdResumeNoFirstTokenLine(line)
    assert.ok(sample)
    assert.equal(sample?.requestId, '03054d22-feb3-4a3b-aaef-a3e5ec51661e')
  })

  it('detects cold resume when no meaningful SSE exists for RID', () => {
    const coldSeenAtMs = Date.now() - 10_000
    const signal = detectMarathonColdResumeNoToken(
      [{ requestId: '03054d22-feb3-4a3b-aaef-a3e5ec51661e', activityMs: coldSeenAtMs }],
      [],
      {
        nowMs: Date.now(),
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      },
    )
    assert.ok(signal)
    assert.deepEqual(signal!.staleRequestIds, ['03054d22-feb3-4a3b-aaef-a3e5ec51661e'])
    assert.ok(signal!.maxGapMs >= 10_000)
  })

  it('ignores cold resume when meaningful SSE already arrived', () => {
    const coldSeenAtMs = Date.now() - 10_000
    const signal = detectMarathonColdResumeNoToken(
      [{ requestId: 'rid-1', activityMs: coldSeenAtMs }],
      [{ requestId: 'rid-1', activityMs: coldSeenAtMs + 1_000 }],
      {
        nowMs: Date.now(),
        cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      },
    )
    assert.equal(signal, undefined)
  })
})
