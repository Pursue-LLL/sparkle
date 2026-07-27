import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countConnectPingFailuresInWindow,
  mergeTransportFailureRows,
} from './transportObservabilityMergeCore'

describe('transportObservabilityMergeCore', () => {
  it('dedupes structured and jsonl rows with same requestId bucket (P18 G1)', () => {
    const ts = Date.parse('2026-07-27T17:42:12.698')
    const row = {
      ts,
      requestId: 'e67c9ec5-754c-46cd-834e-36eaebecdc40',
      originalRequestId: '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d',
      errMsg: '[unavailable] PING timed out',
      connectCode: '14',
      reasonSub: 'dial-timeout',
    }
    const merged = mergeTransportFailureRows([row], [row])
    assert.equal(merged.length, 1)
  })

  it('counts ping failures in sliding window separately per source', () => {
    const nowMs = Date.parse('2026-07-27T17:42:20.000')
    const rows = [
      {
        ts: Date.parse('2026-07-27T17:42:12.698'),
        errMsg: 'PING timed out',
        connectCode: '14',
        requestId: 'a',
      },
      {
        ts: Date.parse('2026-07-27T17:42:12.800'),
        errMsg: 'PING timed out',
        connectCode: '14',
        requestId: 'b',
      },
    ]
    assert.equal(countConnectPingFailuresInWindow(rows, nowMs, 50), 2)
  })

  it('520a4a94 replay keeps pingFailureCount=2 after merge (not 4)', () => {
    const tsA = Date.parse('2026-07-27T17:42:12.698')
    const tsB = Date.parse('2026-07-27T17:42:12.800')
    const structured = [
      {
        ts: tsA,
        requestId: 'e67c9ec5-754c-46cd-834e-36eaebecdc40',
        originalRequestId: '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d',
        errMsg: 'PING timed out',
        connectCode: '14',
      },
      {
        ts: tsB,
        requestId: 'rid-b',
        originalRequestId: '520a4a94-3f18-4e42-a5dd-d7abbd25ed9d',
        errMsg: 'PING timed out',
        connectCode: '14',
      },
    ]
    const jsonl = structured.map((row) => ({ ...row, source: 'sparkle-sync' }))
    const merged = mergeTransportFailureRows(structured, jsonl)
    assert.equal(merged.length, 2)
    assert.equal(
      countConnectPingFailuresInWindow(merged, tsB + 1_000, 436),
      2,
    )
  })
})
