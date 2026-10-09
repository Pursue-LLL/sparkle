import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { effectiveProxyDelay, judgeProxyDelay } from './proxyDelayVerdictCore'

const NOW = Date.parse('2026-10-09T10:40:00.000Z')

function entry(minutesAgo: number, delay: number): ControllerProxiesHistory {
  return { time: new Date(NOW - minutesAgo * 60_000).toISOString(), delay }
}

describe('proxyDelayVerdictCore', () => {
  it('treats missing or empty history as untested', () => {
    assert.deepEqual(judgeProxyDelay(undefined, NOW), { kind: 'untested' })
    assert.deepEqual(judgeProxyDelay([], NOW), { kind: 'untested' })
  })

  it('uses the latest sample when it succeeded', () => {
    const verdict = judgeProxyDelay([entry(9, 0), entry(1, 251)], NOW)
    assert.equal(verdict.kind, 'ok')
    assert.equal(effectiveProxyDelay(verdict), 251)
  })

  it('does not call a single failure a timeout when the node just succeeded', () => {
    const verdict = judgeProxyDelay([entry(6, 280), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'flaky')
    assert.equal(effectiveProxyDelay(verdict), 280)
  })

  it('still tolerates two consecutive failures', () => {
    const verdict = judgeProxyDelay([entry(8, 300), entry(4, 0), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'flaky')
  })

  it('condemns the node after three consecutive failures', () => {
    const verdict = judgeProxyDelay([entry(9, 300), entry(6, 0), entry(3, 0), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'failed')
    assert.equal(effectiveProxyDelay(verdict), 0)
  })

  it('reports a failure when there was never a success', () => {
    assert.equal(judgeProxyDelay([entry(1, 0)], NOW).kind, 'failed')
  })

  it('does not reuse a success that is too old', () => {
    assert.equal(judgeProxyDelay([entry(120, 300), entry(1, 0)], NOW).kind, 'failed')
  })
})
