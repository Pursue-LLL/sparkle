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

  it('dedupes rows in 5s buckets', () => {
    const keyA = rowDedupeKey({ ts: 1_000, requestId: 'rid-a' })
    const keyB = rowDedupeKey({ ts: 1_500, requestId: 'rid-a' })
    const keyC = rowDedupeKey({ ts: 6_000, requestId: 'rid-a' })
    assert.equal(keyA, keyB)
    assert.notEqual(keyA, keyC)
  })
})
