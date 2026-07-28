import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  excludeSessionNudgeSamplesFromProviderHistory,
  readSessionNudgeAnchorsFromLedger,
} from './providerDelayHistoryDisplayCore'

describe('providerDelayHistoryDisplayCore', () => {
  it('reads session_nudge anchors for a node from ledger raw', () => {
    const raw = [
      JSON.stringify({
        ts: '2026-07-23T08:00:00.000Z',
        scope: 'active',
        node: 'JP-VPS-HY2',
        latency_ms: 511,
        ok: true,
        method: 'session_nudge',
      }),
      JSON.stringify({
        ts: '2026-07-23T08:00:01.000Z',
        scope: 'active',
        node: 'KR-VPS-HY2',
        latency_ms: 320,
        ok: true,
        method: 'session_nudge',
      }),
    ].join('\n')

    const anchors = readSessionNudgeAnchorsFromLedger(
      raw,
      Date.parse('2026-07-23T07:59:00.000Z'),
      'JP-VPS-HY2',
    )
    assert.equal(anchors.length, 1)
    assert.equal(anchors[0]?.delayMs, 511)
  })

  it('excludes history bars that match session nudge anchors', () => {
    const history = [
      { time: '2026-07-23T07:58:00.000Z', delay: 303 },
      { time: '2026-07-23T08:00:00.500Z', delay: 511 },
      { time: '2026-07-23T08:05:00.000Z', delay: 298 },
    ]
    const filtered = excludeSessionNudgeSamplesFromProviderHistory(history, [
      { sampledAtMs: Date.parse('2026-07-23T08:00:00.000Z'), delayMs: 511 },
    ])
    assert.deepEqual(
      filtered.map((entry) => entry.delay),
      [303, 298],
    )
  })

  it('keeps baseline nudge samples below spike threshold', () => {
    const history = [
      { time: '2026-07-23T08:00:00.500Z', delay: 303 },
      { time: '2026-07-23T08:05:00.500Z', delay: 298 },
    ]
    const filtered = excludeSessionNudgeSamplesFromProviderHistory(history, [
      { sampledAtMs: Date.parse('2026-07-23T08:00:00.000Z'), delayMs: 303 },
      { sampledAtMs: Date.parse('2026-07-23T08:05:00.000Z'), delayMs: 298 },
    ])
    assert.equal(filtered.length, 2)
  })
})
