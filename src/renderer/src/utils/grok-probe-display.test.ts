import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatGrokProbeDelay, resolveGrokProbeDisplay } from './grok-probe-display'

const NOW = Date.parse('2026-11-11T06:30:00.000Z')

function sample(overrides: Partial<GrokProbeSample> = {}): GrokProbeSample {
  return {
    rttMs: 236,
    checkedAt: NOW - 60_000,
    state: 'usable',
    status: 200,
    ...overrides
  }
}

describe('formatGrokProbeDelay', () => {
  it('renders real request latency in whole milliseconds', () => {
    assert.equal(formatGrokProbeDelay(236), '236')
    assert.equal(formatGrokProbeDelay(1499.6), '1500')
  })

  it('never fabricates a number when the sample is missing', () => {
    assert.equal(formatGrokProbeDelay(0), '—')
    assert.equal(formatGrokProbeDelay(-1), '—')
    assert.equal(formatGrokProbeDelay(Number.NaN), '—')
  })
})

describe('resolveGrokProbeDisplay', () => {
  it('shows milliseconds with age for a verified 200', () => {
    const display = resolveGrokProbeDisplay(sample(), NOW)

    assert.equal(display.text, '236')
    assert.equal(display.tone, 'success')
    assert.equal(display.age, '1分前')
    assert.match(display.tooltip, /真实请求 200 · 236ms · 1分前/)
  })

  it('shows the 403 challenge instead of pretending the node is healthy', () => {
    const display = resolveGrokProbeDisplay(
      sample({ state: 'failed', rttMs: 0, status: 403, reason: 'HTTP 403 cf-mitigated=challenge' }),
      NOW
    )

    assert.equal(display.text, '403')
    assert.equal(display.tone, 'warning')
    assert.match(display.tooltip, /Cloudflare 挑战/)
  })

  it('shows a timeout when no response was received', () => {
    const display = resolveGrokProbeDisplay(
      sample({ state: 'failed', rttMs: 0, status: 0, reason: 'timeout of 8000ms exceeded' }),
      NOW
    )

    assert.equal(display.text, '超时')
    assert.equal(display.tone, 'danger')
    assert.match(display.tooltip, /timeout of 8000ms exceeded/)
  })

  it('marks untested nodes honestly', () => {
    const display = resolveGrokProbeDisplay(null, NOW)

    assert.equal(display.text, '—')
    assert.equal(display.tone, 'default')
    assert.equal(display.age, undefined)
  })
})
