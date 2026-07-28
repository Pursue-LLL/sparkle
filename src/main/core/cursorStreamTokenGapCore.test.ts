import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_TOKEN_GAP_FORCE_MS,
} from './cursorHy2MarathonKeepaliveCore'
import {
  detectMarathonStreamTokenGap,
  detectMarathonColdResumeNoToken,
  detectMarathonSilentGenerationEndRescue,
  expandStreamActivitySampleAliases,
  parseColdResumeNoFirstTokenLine,
  parseRendererStreamActivityLine,
  parseSilentGenerationEndLine,
  CURSOR_SILENT_GENERATION_END_MIN_DURATION_MS,
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

  it('parses df1501ed silent generation end and rescues below token_gap threshold', () => {
    const line =
      '2026-07-25 14:51:54.960 [info] [ifm-event-v1] {"schemaVersion":1,"eventKind":"stream_terminated","occurredAtMs":1784962314581,"requestId":"dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f","originalRequestId":"df1501ed-a0ad-46ae-950c-2057366f88b3","payload":{"terminalMs":1784962314581,"reason":"generation-ended-without-turnEnded","gapSinceActivityMs":7622,"durationMs":6435381}}'
    const sample = parseSilentGenerationEndLine(line)
    assert.ok(sample)
    assert.equal(sample?.requestId, 'dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f')
    assert.equal(sample?.originalRequestId, 'df1501ed-a0ad-46ae-950c-2057366f88b3')
    assert.equal(sample?.gapSinceActivityMs, 7622)

    const signal = detectMarathonSilentGenerationEndRescue([sample!], {
      nowMs: sample!.terminalMs + 5_000,
      cursorConnectionCount: CURSOR_HY2_MARATHON_CONN_THRESHOLD,
      minDurationMs: CURSOR_SILENT_GENERATION_END_MIN_DURATION_MS,
    })
    assert.ok(signal)
    assert.equal(signal!.suddenSilentGenerationEnd, true)
    assert.ok(signal!.maxGapMs < CURSOR_HY2_TOKEN_GAP_FORCE_MS)
    assert.deepEqual(signal!.staleRequestIds, [
      'dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f',
      'df1501ed-a0ad-46ae-950c-2057366f88b3',
    ])
  })

  it('expandStreamActivitySampleAliases indexes txReqId and originalRequestId', () => {
    const line =
      '2026-07-25 14:51:00.000 [info] [ifm-patch-19] SSE audit msgCase=tokenDelta ts=1784962306959 txReqId=dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f genUUID=df1501ed-a0ad-46ae-950c-2057366f88b3'
    const sample = parseRendererStreamActivityLine(line)
    assert.ok(sample)
    const aliases = expandStreamActivitySampleAliases(sample!, line)
    assert.equal(aliases.length, 2)
    assert.deepEqual(
      aliases.map((entry) => entry.requestId).sort(),
      ['dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f', 'df1501ed-a0ad-46ae-950c-2057366f88b3'].sort(),
    )
  })
})
