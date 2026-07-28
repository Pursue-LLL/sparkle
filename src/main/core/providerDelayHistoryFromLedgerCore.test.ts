import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ledgerRowsToProviderDelayHistory,
  LEDGER_PROVIDER_DELAY_HISTORY_LIMIT,
} from './providerDelayHistoryFromLedgerCore'
import type { Api2ProbeLedgerRow } from './api2ProbeLedgerRowCore'

function row(partial: Partial<Api2ProbeLedgerRow> & Pick<Api2ProbeLedgerRow, 'ts' | 'method'>): Api2ProbeLedgerRow {
  return {
    scope: 'active',
    node: 'JP-VPS-HY2',
    latency_ms: 300,
    ok: true,
    authoritative: true,
    ...partial,
  }
}

describe('providerDelayHistoryFromLedgerCore', () => {
  it('maps ok transport_pair rows for the node (session_nudge excluded for Mac full path chart)', () => {
    const rows = [
      row({ ts: '2026-07-24T06:00:00.000Z', method: 'transport_pair', latency_ms: 296 }),
      row({ ts: '2026-07-24T06:01:00.000Z', method: 'session_nudge', latency_ms: 312 }),
      row({ ts: '2026-07-24T06:02:00.000Z', method: 'deferred', latency_ms: -1, ok: false }),
      row({ ts: '2026-07-24T06:03:00.000Z', method: 'transport_pair', node: 'KR-VPS-HY2', latency_ms: 200 }),
    ]
    const history = ledgerRowsToProviderDelayHistory(rows, 'JP-VPS-HY2')
    assert.equal(history.length, 1)
    assert.equal(history[0]?.delay, 296)
  })

  it('returns the last N samples in chronological order', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        ts: `2026-07-24T06:${String(index).padStart(2, '0')}:00.000Z`,
        method: 'transport_pair',
        latency_ms: 200 + index,
      }),
    )
    const history = ledgerRowsToProviderDelayHistory(rows, 'JP-VPS-HY2', 3)
    assert.equal(history.length, 3)
    assert.deepEqual(
      history.map((entry) => entry.delay),
      [207, 208, 209],
    )
  })

  it('defaults to LEDGER_PROVIDER_DELAY_HISTORY_LIMIT', () => {
    const rows = Array.from({ length: LEDGER_PROVIDER_DELAY_HISTORY_LIMIT + 2 }, (_, index) =>
      row({
        ts: `2026-07-24T07:${String(index).padStart(2, '0')}:00.000Z`,
        method: 'transport_pair',
        latency_ms: 250 + index,
      }),
    )
    assert.equal(ledgerRowsToProviderDelayHistory(rows, 'JP-VPS-HY2').length, LEDGER_PROVIDER_DELAY_HISTORY_LIMIT)
  })
})
