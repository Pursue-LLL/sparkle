import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildNatStaleSuspectObservation,
  formatNatStaleSuspectLogLine,
  NAT_STALE_SUSPECT_DEDUPE_COOLDOWN_MS,
  NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS,
  shouldSkipNatStaleSuspectDedupe,
} from './natStaleSuspectObserverCore'

describe('natStaleSuspectObserverCore', () => {
  it('builds observation for split-brain NAT pattern', () => {
    const obs = buildNatStaleSuspectObservation({
      tokenGapMs: NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS,
      api2ProbeOk: true,
      streamPrimarySub: 'server-eof',
      originalRequestId: 'parent-rid',
      requestId: 'segment-rid',
      proxyNode: 'JP-VPS-HY2',
      probeLatencyMs: 287,
      cursorConnectionCount: 42,
      tsMs: 1_700_000_000_000,
    })
    assert.ok(obs)
    assert.equal(obs!.originalRequestId, 'parent-rid')
    assert.match(formatNatStaleSuspectLogLine(obs!), /\[NatStaleSuspect\]:/)
    assert.match(formatNatStaleSuspectLogLine(obs!), /observe_only=true/)
  })

  it('rejects when api2 probe is not green', () => {
    const obs = buildNatStaleSuspectObservation({
      tokenGapMs: NAT_STALE_SUSPECT_MIN_TOKEN_GAP_MS,
      api2ProbeOk: false,
      streamPrimarySub: 'server-eof',
      originalRequestId: 'parent-rid',
      tsMs: 1_700_000_000_000,
    })
    assert.equal(obs, undefined)
  })

  it('dedupes within cooldown window', () => {
    const nowMs = 50_000_000
    assert.equal(
      shouldSkipNatStaleSuspectDedupe(nowMs - NAT_STALE_SUSPECT_DEDUPE_COOLDOWN_MS + 1_000, nowMs),
      true,
    )
    assert.equal(
      shouldSkipNatStaleSuspectDedupe(nowMs - NAT_STALE_SUSPECT_DEDUPE_COOLDOWN_MS - 1_000, nowMs),
      false,
    )
  })
})
