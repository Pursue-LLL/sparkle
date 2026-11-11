import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { agyProbeTone, formatAgyProbeDelay } from './agy-probe-display'

describe('formatAgyProbeDelay', () => {
  it('renders sub-10s latencies with one decimal', () => {
    assert.equal(formatAgyProbeDelay(3900), '3.9s')
    assert.equal(formatAgyProbeDelay(9999), '10s')
  })

  it('rounds longer latencies to whole seconds', () => {
    assert.equal(formatAgyProbeDelay(12_345), '12s')
    assert.equal(formatAgyProbeDelay(51_000), '51s')
  })

  it('renders a missing sample as 未测 instead of a fake number', () => {
    assert.equal(formatAgyProbeDelay(0), '未测')
    assert.equal(formatAgyProbeDelay(-1), '未测')
    assert.equal(formatAgyProbeDelay(Number.NaN), '未测')
  })
})

describe('agyProbeTone', () => {
  it('maps latency bands to display tones', () => {
    assert.equal(agyProbeTone(3900), 'success')
    assert.equal(agyProbeTone(10_000), 'warning')
    assert.equal(agyProbeTone(25_000), 'danger')
  })

  it('keeps a missing sample neutral', () => {
    assert.equal(agyProbeTone(0), 'default')
    assert.equal(agyProbeTone(Number.NaN), 'default')
  })
})
