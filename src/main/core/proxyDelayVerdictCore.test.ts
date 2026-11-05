import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  effectiveProxyDelay,
  judgeOtherProbeUrls,
  judgeProxyDelay,
  judgeProxyForUrl
} from './proxyDelayVerdictCore'

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

  it('identifies flaky node on latest failure and treats effective delay as 0 timeout', () => {
    const verdict = judgeProxyDelay([entry(6, 280), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'flaky')
    assert.equal(effectiveProxyDelay(verdict), 0)
    assert.equal(verdict.kind === 'flaky' ? verdict.delay : 0, 280)
  })

  it('keeps calling a node unstable while its recent window still contains a success but returns 0 current delay', () => {
    // 真实权威：最近一次测试失败即返回 0（超时），但保留历史成功样本供 tooltip 追溯
    const verdict = judgeProxyDelay([entry(14, 0), entry(11, 564), entry(8, 0), entry(5, 0), entry(2, 0), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'flaky')
    assert.equal(effectiveProxyDelay(verdict), 0)
    assert.equal(verdict.kind === 'flaky' ? verdict.delay : 0, 564)
    assert.equal(verdict.kind === 'flaky' ? verdict.sampledAt : '', entry(11, 564).time)
  })

  it('condemns the node only when the whole window has no success', () => {
    const verdict = judgeProxyDelay([entry(9, 0), entry(6, 0), entry(3, 0), entry(1, 0)], NOW)
    assert.equal(verdict.kind, 'failed')
    assert.equal(effectiveProxyDelay(verdict), 0)
  })

  it('reports a failure when there was never a success', () => {
    assert.equal(judgeProxyDelay([entry(1, 0)], NOW).kind, 'failed')
  })

  it('does not reuse a success that is too old', () => {
    assert.equal(judgeProxyDelay([entry(120, 300), entry(1, 0)], NOW).kind, 'failed')
  })

  it('judges a node by the samples of the probe url the group actually uses', () => {
    // 通用网址通、Gemini 一直不通：对 Gemini 组必须判超时，而不是被通用网址的成功样本洗成「波动」
    const node = {
      alive: false,
      history: [entry(9, 0), entry(8, 320), entry(4, 0), entry(3, 318), entry(1, 0)],
      extra: {
        'https://gemini.google.com': { alive: false, history: [entry(9, 0), entry(4, 0), entry(1, 0)] },
        'http://www.gstatic.com/generate_204': { alive: true, history: [entry(8, 320), entry(3, 318)] }
      }
    }
    assert.equal(judgeProxyForUrl(node, 'https://gemini.google.com', NOW).kind, 'failed')
    assert.equal(judgeProxyForUrl(node, 'https://www.gstatic.com/generate_204', NOW).kind, 'ok')
    assert.equal(judgeProxyForUrl(node, 'https://grok.com', NOW).kind, 'untested')
  })

  it('reports how the node does on the other probe urls it has been tested against', () => {
    const node = {
      history: [],
      extra: {
        'https://gemini.google.com': { alive: false, history: [entry(4, 0), entry(1, 0)] },
        'http://www.gstatic.com/generate_204': { alive: true, history: [entry(4, 100), entry(1, 104)] },
        'https://grok.com': { alive: true, history: [] }
      }
    }
    const others = judgeOtherProbeUrls(node, 'https://gemini.google.com', NOW)
    assert.deepEqual(
      others.map((other) => [other.url, other.verdict.kind]),
      [['http://www.gstatic.com/generate_204', 'ok']]
    )
    // 与组探测地址仅协议不同的记录不算「其它地址」
    assert.deepEqual(judgeOtherProbeUrls(node, 'https://www.gstatic.com/generate_204', NOW).map((o) => o.verdict.kind), ['failed'])
  })

  it('lets the newer failure on the https record override the older http success of the same target', () => {
    // 线上形态：体检写 http 记录（旧成功），界面测速写 https 记录（新失败），不能只读到旧成功而显示正常
    const node = {
      history: [],
      extra: {
        'https://gemini.google.com': { alive: false, history: [entry(4, 0), entry(1, 0)] },
        'http://www.gstatic.com/generate_204': { alive: true, history: [entry(5, 1042)] },
        'https://www.gstatic.com/generate_204': { alive: false, history: [entry(1, 0)] }
      }
    }
    assert.equal(judgeProxyForUrl(node, 'https://www.gstatic.com/generate_204', NOW).kind, 'flaky')
    assert.deepEqual(
      judgeOtherProbeUrls(node, 'https://gemini.google.com', NOW).map((o) => o.verdict.kind),
      ['flaky']
    )
  })
})
