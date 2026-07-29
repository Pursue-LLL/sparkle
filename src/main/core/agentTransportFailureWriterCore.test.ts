import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseTransportFailureLine,
  rowDedupeKey,
  shouldPersistTransportFailure,
} from './agentTransportFailureWriterCore'

describe('agentTransportFailureWriterCore', () => {
  it('parses ifm-patch-99 transport-failure with PING timeout', () => {
    const ts = 1_784_601_353_983
    const row = parseTransportFailureLine(
      `2026-07-20 14:56:53.983 [info] [ifm-patch-99 transport-failure] kind="agent_transport_failure" ts=${ts} requestId="rid-1" originalRequestId="rid-1" composerId="cid-1" proxyNode="" reasonType="proxy-network" reasonSub="dial-timeout" errMsg="[unavailable] PING timed out" connectCode="14" attempt=0 activeAgents=2`,
    )
    assert.ok(row)
    assert.equal(row?.ts, ts)
    assert.match(row?.errMsg ?? '', /PING timed out/)
    assert.equal(row?.connectCode, '14')
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('parses ifm-event-v1 stream_terminated connect code 14', () => {
    const row = parseTransportFailureLine(
      `[ifm-event-v1] {"schemaVersion":1,"eventKind":"stream_terminated","occurredAtMs":1784601559269,"requestId":"rid-2","originalRequestId":"rid-2","composerId":"cid-2","attempt":1,"payload":{"connectCode":"14","reason":"[unavailable] PING timed out","activeAgents":3}}`,
    )
    assert.ok(row)
    assert.equal(row?.ts, 1784601559269)
    assert.equal(row?.connectCode, '14')
    assert.equal(row?.activeAgents, 3)
  })

  it('parses exthost ConnectError ETIMEDOUT', () => {
    const row = parseTransportFailureLine(
      '2026-07-21 10:25:30.695 [error] ConnectError: [unavailable] read ETIMEDOUT',
    )
    assert.ok(row)
    assert.equal(row?.reasonSub, 'read-timeout')
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('parses stock renderer ConnectError JSON read ETIMEDOUT code 14', () => {
    const row = parseTransportFailureLine(
      '2026-07-21 11:26:14.272 [error] An unknown error occurred. Please consult the log for more details. {"name":"ConnectError","rawMessage":"read ETIMEDOUT","code":14,"metadata":{},"details":[],"cause":{"errno":-60,"code":"ETIMEDOUT","syscall":"read"}}',
    )
    assert.ok(row)
    assert.equal(row?.connectCode, '14')
    assert.equal(row?.reasonSub, 'read-timeout')
    assert.equal(row?.ts, Date.parse('2026-07-21T11:26:14.272'))
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('parses NAL Structured Logs Stream error PING timeout (520a4a94)', () => {
    const ts = Date.parse('2026-07-27T17:42:12.698')
    const row = parseTransportFailureLine(
      `2026-07-27 17:42:12.698 [error] {"level":"error","key":"transport","message":"Stream error reported from extension host","metadata":{"error.message":"PING timed out","errorCode":"14","requestId":"e67c9ec5-754c-46cd-834e-36eaebecdc40","originalRequestId":"520a4a94-3f18-4e42-a5dd-d7abbd25ed9d","composerId":"3671a22c-5638-4942-8c57-b06d9303e25e"}}`,
    )
    assert.ok(row)
    assert.equal(row?.ts, ts)
    assert.equal(row?.requestId, 'e67c9ec5-754c-46cd-834e-36eaebecdc40')
    assert.equal(row?.originalRequestId, '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d')
    assert.equal(row?.connectCode, '14')
    assert.equal(row?.reasonSub, 'dial-timeout')
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('parses Structured RetriableError PING timeout (520a4a94 THROW chain)', () => {
    const ts = Date.parse('2026-07-27T17:42:12.701')
    const row = parseTransportFailureLine(
      `2026-07-27 17:42:12.701 [error] {"level":"error","message":"RetriableError THROW","metadata":{"error.message":"PING timed out","errorCode":"14","requestId":"throw-rid","originalRequestId":"520a4a94-3f18-4e42-a5dd-d7abbd25ed9d","attempt":5}}`,
    )
    assert.ok(row)
    assert.equal(row?.ts, ts)
    assert.equal(row?.originalRequestId, '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d')
    assert.equal(row?.connectCode, '14')
  })

  it('parses network diagnostic ConnectError PING timeout with kind tag', () => {
    const row = parseTransportFailureLine(
      '2026-07-27 17:57:15.272 [error] Cursor Network Diagnostic ping failed {"name":"ConnectError","rawMessage":"[unavailable] PING timed out","code":14}',
    )
    assert.ok(row)
    assert.equal(row?.kind, 'network_diagnostic_ping_storm')
    assert.match(row?.errMsg ?? '', /PING timed out/)
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('dedupes rows in 5s buckets', () => {
    const keyA = rowDedupeKey({ ts: 1_000, requestId: 'rid-a' })
    const keyB = rowDedupeKey({ ts: 1_500, requestId: 'rid-a' })
    const keyC = rowDedupeKey({ ts: 6_000, requestId: 'rid-a' })
    assert.equal(keyA, keyB)
    assert.notEqual(keyA, keyC)
  })

  it('parses df1501ed generation-ended-without-turnEnded as connect-silent-eof', () => {
    const line =
      '2026-07-25 14:51:54.960 [info] [ifm-event-v1] {"schemaVersion":1,"eventId":"pid-1784946784063-9esseuuh:32983","eventKind":"stream_terminated","source":"workbench-renderer","processInstanceId":"pid-1784946784063-9esseuuh","sequence":32983,"occurredAtMs":1784962314581,"requestId":"dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f","originalRequestId":"df1501ed-a0ad-46ae-950c-2057366f88b3","composerId":"59ee8211-9a8e-4f92-986f-4babb6ec38db","attempt":0,"actionCase":"resumeAction","segmentId":"pid-1784946784063-9esseuuh:segment:11","payload":{"segmentId":"pid-1784946784063-9esseuuh:segment:11","terminalKind":"silent_generation_end","terminalMs":1784962314581,"reason":"generation-ended-without-turnEnded","lastSseCase":"tokenDelta","lastSseN":141569,"pendingTool":0,"lastActivityMs":1784962306959,"gapSinceActivityMs":7622,"durationMs":6435381}}'
    const row = parseTransportFailureLine(line)
    assert.ok(row)
    assert.equal(row?.requestId, 'dd06a733-8ac3-4dc4-80e1-dc2b89bd3e5f')
    assert.equal(row?.originalRequestId, 'df1501ed-a0ad-46ae-950c-2057366f88b3')
    assert.equal(row?.reasonSub, 'connect-silent-eof')
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('does not persist short generation-ended-without-turnEnded as connect-silent-eof', () => {
    const line =
      '[ifm-event-v1] {"schemaVersion":1,"eventKind":"stream_terminated","occurredAtMs":1784962314581,"requestId":"rid-short","originalRequestId":"rid-short","payload":{"reason":"generation-ended-without-turnEnded","durationMs":120000,"gapSinceActivityMs":5000}}'
    const row = parseTransportFailureLine(line)
    assert.ok(row)
    assert.equal(row?.reasonSub, 'stream-end-without-turn')
    assert.equal(row?.reasonType, 'cursor-server')
    assert.equal(shouldPersistTransportFailure(row!), false)
  })

  it('parses 7/29 HTTP SSE server-eof marathon agent-error (BUG-026 D case)', () => {
    const ts = 1_783_732_510_780
    const line =
      `2026-07-29 10:35:10.780 [info] [ifm-patch-29 agent-error] requestId="436bb3ce-f456-4a2a-9c0a-8f1e2d3c4b5a" originalRequestId="5f6f5e93-8aeb-4023-b6c7-746050c822a6" attempt=0 actionCase="userMessageAction" willRetry=true errMsg="server-eof" connectCode="" lastSseCase="tokenDelta" lastSseN=25030 activeAgents=2 composerId="e6829e24-f8f0-4a2b-9c0d-1e2f3a4b5c6d" httpVerObserved="1.1" streamPrimarySub="server-eof" disconnectPhase="phase1_stream" durationMs=2381906 pendingTool=1 gapSinceActivityMs=523 ts=${ts}`
    const row = parseTransportFailureLine(line)
    assert.ok(row)
    assert.equal(row?.kind, 'http_sse_transport_failure')
    assert.equal(row?.reasonSub, 'http-sse-server-eof')
    assert.equal(row?.streamPrimarySub, 'server-eof')
    assert.equal(row?.durationMs, 2_381_906)
    assert.equal(shouldPersistTransportFailure(row!), true)
  })

  it('does not persist short HTTP SSE server-eof under 30min', () => {
    const line =
      '[ifm-patch-29 agent-error] requestId="rid-short" originalRequestId="rid-short" streamPrimarySub="server-eof" durationMs=900000 errMsg="server-eof" ts=1783732510780'
    const row = parseTransportFailureLine(line)
    assert.ok(row)
    assert.equal(row?.reasonSub, 'http-sse-server-eof')
    assert.equal(shouldPersistTransportFailure(row!), false)
  })
})
