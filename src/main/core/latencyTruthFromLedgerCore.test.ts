import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Api2ProbeLedgerRow } from './api2ProbeLedgerRowCore'
import {
  computeDelayP50,
  isMacFullPathLatencyLedgerRow,
  isVpsBodyBenchmarkLedgerRow,
  ledgerRowsToLatencyTruthSummary,
} from './latencyTruthFromLedgerCore'

function row(partial: Partial<Api2ProbeLedgerRow> & Pick<Api2ProbeLedgerRow, 'ts' | 'scope' | 'method'>): Api2ProbeLedgerRow {
  return {
    node: 'JP-VPS-HY2',
    latency_ms: 300,
    ok: true,
    authoritative: true,
    ...partial,
  }
}

describe('latencyTruthFromLedgerCore', () => {
  it('computeDelayP50 handles even and odd counts', () => {
    assert.equal(computeDelayP50([400, 200, 300]), 300)
    assert.equal(computeDelayP50([400, 200]), 300)
    assert.equal(computeDelayP50([]), null)
  })

  it('isVpsBodyBenchmarkLedgerRow accepts only scope=vps ssh_curl ok authoritative', () => {
    assert.equal(
      isVpsBodyBenchmarkLedgerRow(
        row({ ts: '2026-07-24T06:00:00.000Z', scope: 'vps', method: 'ssh_curl', latency_ms: 520 }),
      ),
      true,
    )
    assert.equal(
      isVpsBodyBenchmarkLedgerRow(
        row({ ts: '2026-07-24T06:00:00.000Z', scope: 'vps', method: 'mihomo_delay', latency_ms: 520 }),
      ),
      false,
    )
    assert.equal(
      isVpsBodyBenchmarkLedgerRow(
        row({
          ts: '2026-07-24T06:00:00.000Z',
          scope: 'vps',
          method: 'ssh_curl',
          ok: false,
          latency_ms: -1,
        }),
      ),
      false,
    )
  })

  it('isMacFullPathLatencyLedgerRow accepts transport_pair and marathon_connect_path_pulse', () => {
    assert.equal(
      isMacFullPathLatencyLedgerRow(
        row({ ts: '2026-07-24T06:00:00.000Z', scope: 'active', method: 'transport_pair', latency_ms: 296 }),
      ),
      true,
    )
    assert.equal(
      isMacFullPathLatencyLedgerRow(
        row({
          ts: '2026-07-24T06:00:00.000Z',
          scope: 'active',
          method: 'marathon_connect_path_pulse',
          latency_ms: 312,
        }),
      ),
      true,
    )
    assert.equal(
      isMacFullPathLatencyLedgerRow(
        row({ ts: '2026-07-24T06:00:00.000Z', scope: 'active', method: 'session_nudge', latency_ms: 780 }),
      ),
      false,
    )
  })

  it('ledgerRowsToLatencyTruthSummary includes marathon_connect_path_pulse in mac path', () => {
    const rows = [
      row({ ts: '2026-07-24T06:00:00.000Z', scope: 'vps', node: 'JP-VPS', method: 'ssh_curl', latency_ms: 500 }),
      row({
        ts: '2026-07-24T06:02:00.000Z',
        scope: 'active',
        method: 'marathon_connect_path_pulse',
        latency_ms: 293,
      }),
      row({ ts: '2026-07-24T06:03:00.000Z', scope: 'active', method: 'transport_pair', latency_ms: 300 }),
    ]
    const summary = ledgerRowsToLatencyTruthSummary(rows, 'JP-VPS-HY2')
    assert.equal(summary.macFullPathSamples, 2)
    assert.equal(summary.macFullPathP50, 296.5)
  })

  it('ledgerRowsToLatencyTruthSummary splits vps body vs mac full path per node', () => {
    const rows = [
      row({ ts: '2026-07-24T06:00:00.000Z', scope: 'vps', node: 'JP-VPS', method: 'ssh_curl', latency_ms: 500 }),
      row({ ts: '2026-07-24T06:01:00.000Z', scope: 'vps', node: 'JP-VPS', method: 'ssh_curl', latency_ms: 540 }),
      row({ ts: '2026-07-24T06:02:00.000Z', scope: 'active', method: 'transport_pair', latency_ms: 280 }),
      row({ ts: '2026-07-24T06:03:00.000Z', scope: 'active', method: 'transport_pair', latency_ms: 300 }),
      row({ ts: '2026-07-24T06:04:00.000Z', scope: 'active', method: 'session_nudge', latency_ms: 780 }),
      row({
        ts: '2026-07-24T06:05:00.000Z',
        scope: 'vps',
        method: 'ssh_curl',
        node: 'KR-VPS',
        latency_ms: 200,
      }),
    ]
    const summary = ledgerRowsToLatencyTruthSummary(rows, 'JP-VPS-HY2')
    assert.equal(summary.vpsBodySamples, 2)
    assert.equal(summary.vpsBodyP50, 520)
    assert.equal(summary.macFullPathSamples, 2)
    assert.equal(summary.macFullPathP50, 290)
  })
})
