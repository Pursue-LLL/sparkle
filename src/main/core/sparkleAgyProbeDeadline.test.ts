import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  AGY_MIN_PROBE_TIMEOUT_MS,
  resolveProbeTimeoutMs,
  runAgyAudit,
  type AgyAuditOutcome
} from './sparkleAgyProbeCore'
import type { AgyNodeProbeRecord, AgyProxyRecord } from './sparkleAgyProviderCore'

const NODES: AgyProxyRecord[] = [
  { name: 'node-a', type: 'vmess', server: 'a.example', port: 443 },
  { name: 'node-b', type: 'vmess', server: 'b.example', port: 443 },
  { name: 'node-c', type: 'vmess', server: 'c.example', port: 443 }
]

const UNUSABLE: AgyAuditOutcome = { verdict: 'unusable', rttMs: 100, fatal: false }
const SEC = 1000

describe('resolveProbeTimeoutMs', () => {
  it('uses the limit while the deadline is far away', () => {
    assert.equal(resolveProbeTimeoutMs(60 * SEC, 1_000_000, 0), 60 * SEC)
  })

  it('tightens the timeout so the probe cannot outlive the deadline', () => {
    assert.equal(resolveProbeTimeoutMs(60 * SEC, 100 * SEC, 55 * SEC), 45 * SEC)
  })

  it('refuses a probe that could not finish a cold start before the deadline', () => {
    const now = 100 * SEC
    assert.equal(
      resolveProbeTimeoutMs(60 * SEC, now + AGY_MIN_PROBE_TIMEOUT_MS - 1, now),
      undefined
    )
    assert.equal(
      resolveProbeTimeoutMs(60 * SEC, now + AGY_MIN_PROBE_TIMEOUT_MS, now),
      AGY_MIN_PROBE_TIMEOUT_MS
    )
    assert.equal(resolveProbeTimeoutMs(60 * SEC, now - 1, now), undefined)
  })

  it('places no limit when there is no deadline', () => {
    assert.equal(resolveProbeTimeoutMs(90 * SEC, Number.POSITIVE_INFINITY, 5), 90 * SEC)
  })
})

describe('runAgyAudit under a deadline', () => {
  it('hands each probe a timeout tightened to what is left before the deadline', async () => {
    let clock = 0
    const timeouts: number[] = []

    await runAgyAudit(
      {
        pending: NODES,
        cache: new Map<string, AgyNodeProbeRecord>(),
        budgetMs: 600 * SEC,
        probeTimeoutMs: 60 * SEC,
        deadlineAtMs: 130 * SEC
      },
      {
        now: () => clock,
        probeNode: async (_node, timeoutMs) => {
          timeouts.push(timeoutMs)
          clock += 50 * SEC
          return UNUSABLE
        }
      }
    )

    // 第 3 个节点开始时离截止只剩 30s，恰好够一次探测。
    assert.deepEqual(timeouts, [60 * SEC, 60 * SEC, 30 * SEC])
  })

  it('does not start a probe it cannot finish and leaves the rest untried', async () => {
    let clock = 0
    const probed: string[] = []
    const attempted = new Map<string, number>()

    const result = await runAgyAudit(
      {
        pending: NODES,
        cache: new Map<string, AgyNodeProbeRecord>(),
        budgetMs: 600 * SEC,
        probeTimeoutMs: 60 * SEC,
        deadlineAtMs: 85 * SEC,
        attempted
      },
      {
        now: () => clock,
        probeNode: async (node) => {
          probed.push(node)
          clock += 60 * SEC
          return UNUSABLE
        }
      }
    )

    assert.deepEqual(probed, ['node-a'])
    assert.deepEqual(result, {
      probed: 1,
      usable: 0,
      aborted: true,
      outOfTime: true,
      usableNode: null
    })
    // 没发出去的探测不能算「试过了」，否则下一轮排序会无故跳过它们。
    assert.deepEqual([...attempted.keys()], [computeProxyNodeFingerprint(NODES[0]!)])
  })

  it('aborts at once when the deadline has already passed', async () => {
    const probed: string[] = []

    const result = await runAgyAudit(
      {
        pending: NODES,
        cache: new Map<string, AgyNodeProbeRecord>(),
        budgetMs: 600 * SEC,
        probeTimeoutMs: 60 * SEC,
        deadlineAtMs: 5
      },
      {
        now: () => 10,
        probeNode: async (node) => {
          probed.push(node)
          return UNUSABLE
        }
      }
    )

    assert.deepEqual(probed, [])
    assert.deepEqual(result, {
      probed: 0,
      usable: 0,
      aborted: true,
      outOfTime: true,
      usableNode: null
    })
  })

  it('runs every probe with the plain limit when no deadline is given', async () => {
    const timeouts: number[] = []

    await runAgyAudit(
      {
        pending: NODES,
        cache: new Map<string, AgyNodeProbeRecord>(),
        budgetMs: 600 * SEC,
        probeTimeoutMs: 60 * SEC
      },
      {
        now: () => 0,
        probeNode: async (_node, timeoutMs) => {
          timeouts.push(timeoutMs)
          return UNUSABLE
        }
      }
    )

    assert.deepEqual(timeouts, [60 * SEC, 60 * SEC, 60 * SEC])
  })
})
