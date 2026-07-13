import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ledgerRowToBenchmarkSample,
  readApi2ProbeLedgerRowsSince
} from './api2ProbeLedgerRowCore'

describe('api2ProbeLedgerCore', () => {
  it('filters rows by scope and sinceMs', () => {
    const raw = [
      '{"ts":"2026-07-10T01:00:00.000Z","scope":"active","node":"KR-VPS","latency_ms":120,"ok":true,"authoritative":true,"method":"transport_pair"}',
      '{"ts":"2026-07-10T02:00:00.000Z","scope":"vps","node":"JP-VPS","region":"JP","kind":"vps","latency_ms":200,"ok":true,"authoritative":true,"method":"mihomo_delay"}',
      '{"ts":"2026-07-09T00:00:00.000Z","scope":"vps","node":"old","latency_ms":1,"ok":true,"authoritative":true,"method":"mihomo_delay"}'
    ].join('\n')

    const sinceMs = Date.parse('2026-07-10T00:30:00.000Z')
    const active = readApi2ProbeLedgerRowsSince(raw, sinceMs, 'active')
    assert.equal(active.length, 1)
    assert.equal(active[0]?.node, 'KR-VPS')

    const vps = readApi2ProbeLedgerRowsSince(raw, sinceMs, 'vps')
    assert.equal(vps.length, 1)
    assert.equal(vps[0]?.node, 'JP-VPS')
  })

  it('maps vps ledger row to benchmark sample', () => {
    const sample = ledgerRowToBenchmarkSample({
      ts: '2026-07-10T02:00:00.000Z',
      scope: 'vps',
      node: 'JP-VPS-HY2',
      region: 'JP',
      kind: 'vps',
      latency_ms: 180,
      ok: true,
      authoritative: true,
      method: 'mihomo_delay'
    })
    assert.equal(sample.node, 'JP-VPS-HY2')
    assert.equal(sample.delay_ms, 180)
    assert.equal(sample.kind, 'vps')
  })
})
