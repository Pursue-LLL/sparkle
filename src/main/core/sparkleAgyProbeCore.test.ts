import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  AGY_PIN_UNKNOWN_STREAK_LIMIT,
  resolveAgyAuditBackoffMs,
  runAgyAudit,
  shouldRepairAgyPin,
  type AgyAuditOutcome
} from './sparkleAgyProbeCore'
import type { AgyNodeProbeRecord, AgyProxyRecord } from './sparkleAgyProviderCore'

const NODES: AgyProxyRecord[] = [
  { name: '新加坡-优化2-GPT', type: 'vmess', server: 'sg.example', port: 16618 },
  { name: '美国LA-优化2-GPT', type: 'vmess', server: 'us.example', port: 16648 },
  { name: '🇯🇵 日本 02', type: 'vless', server: 'jp.example', port: 443 }
]

function outcomeOf(
  verdict: AgyAuditOutcome['verdict'],
  rttMs = 500,
  fatal = false
): AgyAuditOutcome {
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
      { pending: NODES, cache, budgetMs: 60_000, probeTimeoutMs: 60_000 },
      {
        now: () => 1000,
        probeNode: async (node) => {
          probed.push(node)
          return verdicts.get(node) ?? outcomeOf('unknown')
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT', '美国LA-优化2-GPT', '🇯🇵 日本 02'])
    assert.deepEqual(result, {
      probed: 2,
      usable: 1,
      aborted: false,
      outOfTime: false,
      usableNode: '美国LA-优化2-GPT'
    })
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

  it('stops on the first usable node when stopOnUsable is set', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const probed: string[] = []

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000, probeTimeoutMs: 60_000, stopOnUsable: true },
      {
        probeNode: async (node) => {
          probed.push(node)
          return outcomeOf('usable', 320)
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT'])
    assert.deepEqual(result, {
      probed: 1,
      usable: 1,
      aborted: false,
      outOfTime: false,
      usableNode: '新加坡-优化2-GPT'
    })
    assert.equal(cache.size, 1)
  })

  it('keeps scanning unusable nodes until a usable one is found', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const probed: string[] = []

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000, probeTimeoutMs: 60_000, stopOnUsable: true },
      {
        probeNode: async (node) => {
          probed.push(node)
          return node === '🇯🇵 日本 02' ? outcomeOf('usable', 900) : outcomeOf('unusable', 120)
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT', '美国LA-优化2-GPT', '🇯🇵 日本 02'])
    assert.deepEqual(result, {
      probed: 3,
      usable: 1,
      aborted: false,
      outOfTime: false,
      usableNode: '🇯🇵 日本 02'
    })
  })

  it('records every attempted node (including undecided timeouts) for repair progress', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const attempted = new Map<string, number>()

    await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000, probeTimeoutMs: 60_000, attempted },
      {
        now: () => 1000,
        probeNode: async (node) =>
          node === '🇯🇵 日本 02' ? outcomeOf('unknown') : outcomeOf('usable')
      }
    )

    assert.equal(attempted.get(computeProxyNodeFingerprint(NODES[0]!)), 1000)
    assert.equal(attempted.get(computeProxyNodeFingerprint(NODES[2]!)), 1000)
    // 超时仍然不写缓存（避免误判节点死亡），只是记录「试过了」。
    assert.equal(cache.has(computeProxyNodeFingerprint(NODES[2]!)), false)
  })

  it('stops the whole audit on a fatal magpie-side error', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    const probed: string[] = []

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 60_000, probeTimeoutMs: 60_000 },
      {
        now: () => 1000,
        probeNode: async (node) => {
          probed.push(node)
          return node === '美国LA-优化2-GPT'
            ? outcomeOf('fatal', 0, true)
            : outcomeOf('usable', 300)
        }
      }
    )

    assert.deepEqual(probed, ['新加坡-优化2-GPT', '美国LA-优化2-GPT'])
    assert.deepEqual(result, {
      probed: 1,
      usable: 1,
      aborted: true,
      outOfTime: false,
      usableNode: '新加坡-优化2-GPT'
    })
  })

  it('stops when the audit budget is exhausted and keeps earlier verdicts', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    let clock = 0

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 500, probeTimeoutMs: 60_000 },
      {
        now: () => clock,
        probeNode: async () => {
          clock += 900
          return outcomeOf('usable', 400)
        }
      }
    )

    assert.deepEqual(result, {
      probed: 1,
      usable: 1,
      aborted: true,
      outOfTime: false,
      usableNode: '新加坡-优化2-GPT'
    })
  })

  it('keeps probing while the elapsed time equals the budget and stops one millisecond past it', async () => {
    const cache = new Map<string, AgyNodeProbeRecord>()
    let clock = 0

    const result = await runAgyAudit(
      { pending: NODES, cache, budgetMs: 500, probeTimeoutMs: 60_000 },
      {
        now: () => clock,
        probeNode: async () => {
          clock += 500
          return outcomeOf('unusable')
        }
      }
    )

    // 第 2 个节点开始时恰好用掉 500ms：预算「超过」才中止，所以第 2 个还要测；第 3 个开始时已超出。
    assert.deepEqual(result, {
      probed: 2,
      usable: 0,
      aborted: true,
      outOfTime: false,
      usableNode: null
    })
  })

  it('handles an empty pending list', async () => {
    const result = await runAgyAudit(
      { pending: [], cache: new Map(), budgetMs: 1000, probeTimeoutMs: 60_000 },
      { probeNode: async () => outcomeOf('usable') }
    )
    assert.deepEqual(result, {
      probed: 0,
      usable: 0,
      aborted: false,
      outOfTime: false,
      usableNode: null
    })
  })
})

describe('shouldRepairAgyPin', () => {
  it('repairs immediately when there is no pin or the retried probe still says unusable', () => {
    assert.equal(shouldRepairAgyPin({ pinVerdict: null, unknownStreak: 0 }), true)
    assert.equal(shouldRepairAgyPin({ pinVerdict: 'unusable', unknownStreak: 0 }), true)
  })

  it('tolerates one timeout round and repairs on consecutive timeouts', () => {
    assert.equal(shouldRepairAgyPin({ pinVerdict: 'unknown', unknownStreak: 1 }), false)
    assert.equal(
      shouldRepairAgyPin({ pinVerdict: 'unknown', unknownStreak: AGY_PIN_UNKNOWN_STREAK_LIMIT }),
      true
    )
  })

  it('never repairs while the pin is usable, whatever the timeout streak was before', () => {
    assert.equal(shouldRepairAgyPin({ pinVerdict: 'usable', unknownStreak: 0 }), false)
    assert.equal(
      shouldRepairAgyPin({ pinVerdict: 'usable', unknownStreak: AGY_PIN_UNKNOWN_STREAK_LIMIT + 5 }),
      false
    )
  })
})

describe('resolveAgyAuditBackoffMs', () => {
  const INTERVAL = 3 * 60 * 1000

  it('does not back off after a round with at least one usable node', () => {
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 0), 0)
  })

  it('grows the skip window on consecutive empty rounds and caps at 3x', () => {
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 1), INTERVAL * 1)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 2), INTERVAL * 2)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 3), INTERVAL * 3)
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, 9), INTERVAL * 3)
  })

  it('never produces a negative window', () => {
    assert.equal(resolveAgyAuditBackoffMs(INTERVAL, -1), 0)
  })
})

describe('runAgyAudit remembers rejections', () => {
  const [sg, us, jp] = NODES as [AgyProxyRecord, AgyProxyRecord, AgyProxyRecord]
  const verdictByNode = (verdicts: Record<string, AgyAuditOutcome['verdict']>) => ({
    now: () => 5000,
    probeNode: async (node: string): Promise<AgyAuditOutcome> =>
      outcomeOf(verdicts[node] ?? 'unknown')
  })

  it('flags only the nodes whose exit was judged unusable, with the judgement time', async () => {
    const flags = new Map<string, number>()

    await runAgyAudit(
      { pending: NODES, cache: new Map(), budgetMs: 60_000, probeTimeoutMs: 60_000, flags },
      verdictByNode({ '新加坡-优化2-GPT': 'unusable', '美国LA-优化2-GPT': 'usable' })
    )

    assert.deepEqual([...flags], [[computeProxyNodeFingerprint(sg), 5000]])
  })

  it('lets a later passing probe leave an earlier flag standing', async () => {
    const flags = new Map([[computeProxyNodeFingerprint(us), 1000]])

    await runAgyAudit(
      { pending: [us], cache: new Map(), budgetMs: 60_000, probeTimeoutMs: 60_000, flags },
      verdictByNode({ '美国LA-优化2-GPT': 'usable' })
    )

    assert.equal(flags.get(computeProxyNodeFingerprint(us)), 1000)
  })

  it('refreshes the flag when a flagged node is judged unusable again', async () => {
    const flags = new Map([[computeProxyNodeFingerprint(jp), 1000]])

    await runAgyAudit(
      { pending: [jp], cache: new Map(), budgetMs: 60_000, probeTimeoutMs: 60_000, flags },
      verdictByNode({ '🇯🇵 日本 02': 'unusable' })
    )

    assert.equal(flags.get(computeProxyNodeFingerprint(jp)), 5000)
  })

  it('does not flag a node that only timed out', async () => {
    const flags = new Map<string, number>()

    await runAgyAudit(
      { pending: NODES, cache: new Map(), budgetMs: 60_000, probeTimeoutMs: 60_000, flags },
      verdictByNode({})
    )

    assert.equal(flags.size, 0)
  })

  it('audits normally when no flag memory is supplied', async () => {
    const result = await runAgyAudit(
      { pending: [sg], cache: new Map(), budgetMs: 60_000, probeTimeoutMs: 60_000 },
      verdictByNode({ '新加坡-优化2-GPT': 'unusable' })
    )

    assert.equal(result.probed, 1)
  })
})
