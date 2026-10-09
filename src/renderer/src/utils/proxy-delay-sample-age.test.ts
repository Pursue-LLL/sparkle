import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatFlakyDelayTooltip,
  formatProxyDelaySampleAge,
  formatProxyDelayTooltip,
  latestProxyDelayHistoryEntry,
} from './proxy-delay-sample-age'

describe('proxyDelaySampleAge', () => {
  it('returns latest history entry', () => {
    const latest = latestProxyDelayHistoryEntry([
      { time: '2026-07-01T08:00:00.000Z', delay: 900 },
      { time: '2026-07-01T09:00:00.000Z', delay: 0 }
    ])
    assert.equal(latest?.delay, 0)
    assert.equal(latest?.time, '2026-07-01T09:00:00.000Z')
  })

  it('returns undefined for empty history', () => {
    assert.equal(latestProxyDelayHistoryEntry([]), undefined)
    assert.equal(latestProxyDelayHistoryEntry(undefined), undefined)
  })

  it('formats relative age buckets', () => {
    const now = Date.parse('2026-07-01T10:05:30.000Z')
    assert.equal(formatProxyDelaySampleAge('2026-07-01T10:05:00.000Z', now, 'zh'), '30秒前')
    assert.equal(formatProxyDelaySampleAge('2026-07-01T09:50:00.000Z', now, 'zh'), '15分前')
    assert.equal(formatProxyDelaySampleAge('2026-07-01T08:05:30.000Z', now, 'en'), '2h ago')
  })

  it('builds delay tooltip with sample age', () => {
    const now = Date.parse('2026-07-01T10:05:30.000Z')
    const tip = formatProxyDelayTooltip(1137, '2026-07-01T09:50:00.000Z', now, 'zh')
    assert.match(tip ?? '', /测试于 15分前 · 1137ms/)
  })

  it('marks timeout without timestamp gracefully', () => {
    assert.equal(formatProxyDelayTooltip(0, undefined, Date.now(), 'zh'), '延迟测试超时')
  })

  it('has no tooltip for untested nodes', () => {
    assert.equal(formatProxyDelayTooltip(-1, undefined, Date.now(), 'zh'), undefined)
  })

  it('explains a flaky node without calling it timed out', () => {
    const now = Date.parse('2026-07-01T10:05:30.000Z')
    const tip = formatFlakyDelayTooltip(280, '2026-07-01T09:50:00.000Z', now)
    assert.match(tip, /最近一次测速失败/)
    assert.match(tip, /15分前成功 280ms/)
    assert.doesNotMatch(tip, /超时/)
  })
})
