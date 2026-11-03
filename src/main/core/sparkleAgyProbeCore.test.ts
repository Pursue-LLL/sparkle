import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { resolveAgyAuditBackoffMs, runAgyAudit, type AgyAuditOutcome } from './sparkleAgyProbeCore'
import type { AgyNodeProbeRecord, AgyProxyRecord } from './sparkleAgyProviderCore'

const NODES: AgyProxyRecord[] = [
  { name: '新加坡-优化2-GPT', type: 'vmess', server: 'sg.example', port: 16618 },
  { name: '美国LA-优化2-GPT', type: 'vmess', server: 'us.example', port: 16648 },
  { name: '🇯🇵 日本 02', type: 'vless', server: 'jp.example', port: 443 }
]

function outcomeOf(verdict: AgyAuditOutcome['verdict'], rttMs = 500, fatal = false): AgyAuditOutcome {
  return { verdict, rttMs, fatal }
}

describe('runAgyAudit', () => {
  it('records usable and unusable verdicts by node fingerprint', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const probed: string[] = []
    const verdicts = new Map<string, AgyAuditOutcome>([
      ['新加坡-优化2-GPT', outcomeOf('unusable', 210)],
      ['美国LA-优化2-GPT', outcomeOf('usable', 640)],
      ['🇯🇵 日本 02', outcomeOf('unknown', 0)]
    ])

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000 },
      {
        now: () => 1000,
        probeNode: async (node) => {
          probed.push(node)
          return verdicts.get(node) ?? outcomeOf('unknown')
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT', '美国LA-优化2-GPT', '🇯🇵 日本 02'])
    assert.deepEqual(result, { probed: 2, usable: 1, aborted: false })
    assert.deepEqual(cache.get(computeProxyNodeFingerprint(NODES[0]!)), {
      usable: false,
      rttMs: 210,
      checkedAt: 1000
    })
    assert.deepEqual(cache.get(computeProxyNodeFingerprint(NODES[1]!)), {
      usable: true,
      rttMs: 640,
      checkedAt: 1000
    })
    // 无法定性的节点绝不写缓存，避免把健康节点误标成不可用。
    assert.equal(cache.has(computeProxyNodeFingerprint(NODES[2]!)), false)
  })

  it('stops the whole audit on a fatal magpie-side error', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const probed: string[] = []

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000 },
      {
        now: () => 1000,
        probeNode: async (node) => {
          probed.push(node)
          return node === '美国LA-优化2-GPT' ? outcomeOf('fatal', 0, true) : outcomeOf('usable', 300)
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT', '美国LA-优化2-GPT'])
    assert.deepEqual(result, { probed: 1, usable: 1, aborted: true })
  })

  it('stops when the audit budget is exhausted and keeps earlier verdicts', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    let clock = 0

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 500 },
      {
        now: () => clock,
        probeNode: async () => {
          clock += 900
          return outcomeOf('usable', 400)
        }
      }
    )

    assert.deepEqual(result, { probed: 1, usable: 1, aborted: true })
  })

  it('handles an empty pending list', async () => {
    const result = await runAgyAudit(
      { pending: [], cache: new Map(), budgetMs: 1000 },
      { probeNode: async () => outcomeOf('usable') }
    )
    assert.deepEqual(result, { probed: 0, usable: 0, aborted: false })
  })
})

describe('resolveAgyAuditBackoffMs', () => {
  const INTERVAL = 15 * 60 * 1000

  it('does not back off after a round with at least one usable node', () => {
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 0), 0)
  })

  it('grows the skip window on consecutive empty rounds and caps at 3x', () => {
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 1), INTERVAL * 1)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 2), INTERVAL * 2)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 3), INTERVAL * 3)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 9), INTERVAL * 3)
  })
})
