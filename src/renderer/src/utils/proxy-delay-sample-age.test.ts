import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatProxyDelaySampleAge,
  formatProxyDelayTooltip,
  latestProxyDelayHistoryEntry,
  latestSuccessfulProxyDelayHistoryEntry
} from './proxy-delay-sample-age'

describe('proxyDelaySampleAgeCore', () => {
  it('returns latest history entry', () => {
    const latest = latestProxyDelayHistoryEntry([
      { time: '2026-07-01T08:00:00.000Z', delay: 900 },
      { time: '2026-07-01T09:00:00.000Z', delay: 0 }
    ])
    assert.equal(latest?.delay, 0)
    assert.equal(latest?.time, '2026-07-01T09:00:00.000Z')
  })

  it('skips trailing timeout samples for list display', () => {
    const latest = latestSuccessfulProxyDelayHistoryEntry([
      { time: '2026-07-01T08:00:00.000Z', delay: 446 },
      { time: '2026-07-01T09:00:00.000Z', delay: 0 }
    ])
    assert.equal(latest?.delay, 446)
    assert.equal(latest?.time, '2026-07-01T08:00:00.000Z')
  })

  it('returns trailing zero when entire history failed', () => {
    const latest = latestSuccessfulProxyDelayHistoryEntry([
      { time: '2026-07-01T09:00:00.000Z', delay: 0 }
    ])
    assert.equal(latest?.delay, 0)
  })

  it('formats relative age buckets', () => {
    const now = Date.parse('2026-07-01T10:05:30.000Z')
    assert.equal(
      formatProxyDelaySampleAge('2026-07-01T10:05:00.000Z', now, 'zh'),
      '30秒前'
    )
    assert.equal(
      formatProxyDelaySampleAge('2026-07-01T09:50:00.000Z', now, 'zh'),
      '15分前'
    )
    assert.equal(
      formatProxyDelaySampleAge('2026-07-01T08:05:30.000Z', now, 'en'),
      '2h ago'
    )
  })

  it('builds delay tooltip with stale sample hint', () => {
    const now = Date.parse('2026-07-01T10:05:30.000Z')
    const tip = formatProxyDelayTooltip(
      1137,
      '2026-07-01T09:50:00.000Z',
      now,
      'zh'
    )
    assert.match(tip ?? '', /测试于 15分前 · 1137ms/)
  })

  it('marks timeout without timestamp gracefully', () => {
    const tip = formatProxyDelayTooltip(0, undefined, Date.now(), 'zh')
    assert.equal(tip, '延迟测试超时')
  })
})
