import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  buildGrokProbeSnapshot,
  buildSparkleGrokProviderDocument,
  grokProviderMembershipChanged,
  GROK_POOL_MAX_SIZE,
  GROK_POOL_TRUST_MS,
  isGrokRoutedResponseUsable,
  orderGrokProxies,
  orderGrokRepairCandidates,
  type GrokNodeProbeCache,
  type GrokNodeProbeRecord,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'

function node(name: string, server = 'example.com'): GrokProxyRecord {
  return { name, type: 'vmess', server, port: 443 }
}

function cacheOf(
  entries: Array<{ proxy: GrokProxyRecord; alive: boolean; rttMs: number }>
): GrokNodeProbeCache {
  const map = new Map<string, GrokNodeProbeRecord>()
  for (const entry of entries) {
    map.set(computeProxyNodeFingerprint(entry.proxy), {
      alive: entry.alive,
      rttMs: entry.rttMs,
      checkedAt: Date.now()
    })
  }
  return map
}

describe('sparkleGrokProviderCore', () => {
  it('treats only 200 without a Cloudflare challenge as usable', () => {
    assert.equal(isGrokRoutedResponseUsable(200, ''), true)
    assert.equal(isGrokRoutedResponseUsable(200, 'challenge'), false)
    assert.equal(isGrokRoutedResponseUsable(200, 'CHALLENGE'), false)
    assert.equal(isGrokRoutedResponseUsable(403, ''), false)
    assert.equal(isGrokRoutedResponseUsable(302, ''), false)
    assert.equal(isGrokRoutedResponseUsable(0, ''), false)
  })
  it('keeps every node when there is no probe cache yet', () => {
    const proxies = [node('HK-01'), node('JP-01'), node('US-01')]

    assert.deepEqual(orderGrokProxies(proxies), proxies)
    assert.deepEqual(buildSparkleGrokProviderDocument({ proxies }).proxies, proxies)
  })

  it('keeps only verified HTTP 200 nodes sorted by rtt', () => {
    const slow = node('US-01')
    const fast = node('JP-01')
    const blocked = node('HK-01')
    const cache = cacheOf([
      { proxy: slow, alive: true, rttMs: 320 },
      { proxy: fast, alive: true, rttMs: 90 },
      { proxy: blocked, alive: false, rttMs: 0 }
    ])

    assert.deepEqual(orderGrokProxies([blocked, slow, fast], cache), [fast, slow])
  })

  it('falls back to the full list when every verified node is dead', () => {
    const proxies = [node('HK-01'), node('SG-01')]
    const cache = cacheOf([
      { proxy: proxies[0], alive: false, rttMs: 0 },
      { proxy: proxies[1], alive: false, rttMs: 0 }
    ])

    assert.deepEqual(orderGrokProxies(proxies, cache), proxies)
  })

  it('ignores pool samples older than the trust window', () => {
    const proxies = [node('JP-01'), node('US-01')]
    const cache = cacheOf([{ proxy: proxies[0], alive: true, rttMs: 90 }])

    assert.deepEqual(orderGrokProxies(proxies, cache), [proxies[0]])
    assert.deepEqual(orderGrokProxies(proxies, cache, Date.now() + GROK_POOL_TRUST_MS + 1), proxies)
  })

  it('caps the pool at the fastest verified nodes', () => {
    const proxies = Array.from({ length: GROK_POOL_MAX_SIZE + 3 }, (_, i) => node(`JP-${i}`))
    const cache = cacheOf(proxies.map((proxy, i) => ({ proxy, alive: true, rttMs: 100 + i * 10 })))

    const ordered = orderGrokProxies(proxies, cache)

    assert.equal(ordered.length, GROK_POOL_MAX_SIZE)
    assert.deepEqual(
      ordered.map((proxy) => proxy.name),
      proxies.slice(0, GROK_POOL_MAX_SIZE).map((proxy) => proxy.name)
    )
  })

  it('keeps HK-named nodes as last-resort even when they are the fastest', () => {
    const hk = node('🇭🇰 香港 I3 | IEPL')
    const jp = node('🇯🇵 日本 01')
    const us = node('🇺🇸 美国 01')
    const cache = cacheOf([
      { proxy: hk, alive: true, rttMs: 100 },
      { proxy: jp, alive: true, rttMs: 300 },
      { proxy: us, alive: true, rttMs: 400 }
    ])

    assert.deepEqual(orderGrokProxies([hk, jp, us], cache), [jp, us, hk])
  })

  it('dedupes repeated names and drops nameless entries', () => {
    const proxies = [node('JP-01'), node('JP-01'), { type: 'vmess' } as GrokProxyRecord]

    assert.deepEqual(orderGrokProxies(proxies), [node('JP-01')])
  })

  it('maps only known nodes into the UI snapshot, keeping real status and reason', () => {
    const ok = node('JP-01')
    const blocked = node('HK-01')
    const removed = node('US-OLD')
    const cache = new Map<string, GrokNodeProbeRecord>()
    cache.set(computeProxyNodeFingerprint(ok), {
      alive: true,
      rttMs: 236,
      checkedAt: 1000,
      status: 200
    })
    cache.set(computeProxyNodeFingerprint(blocked), {
      alive: false,
      rttMs: 0,
      checkedAt: 2000,
      status: 403,
      reason: 'HTTP 403 cf-mitigated=challenge'
    })
    cache.set(computeProxyNodeFingerprint(removed), {
      alive: true,
      rttMs: 100,
      checkedAt: 3000,
      status: 200
    })

    assert.deepEqual(buildGrokProbeSnapshot([ok, blocked], cache), {
      'JP-01': { rttMs: 236, checkedAt: 1000, state: 'usable', status: 200 },
      'HK-01': {
        rttMs: 0,
        checkedAt: 2000,
        state: 'failed',
        status: 403,
        reason: 'HTTP 403 cf-mitigated=challenge'
      }
    })
  })

  it('returns an empty snapshot when no probe has run yet', () => {
    assert.deepEqual(buildGrokProbeSnapshot([node('JP-01')]), {})
    assert.deepEqual(buildGrokProbeSnapshot([node('JP-01')], new Map()), {})
  })

  it('moves recently attempted nodes behind untried candidates', () => {
    const attempted = node('JP-01')
    const freshA = node('JP-02')
    const freshB = node('JP-03')
    const attempts = new Map([[computeProxyNodeFingerprint(attempted), 1000]])

    assert.deepEqual(
      orderGrokRepairCandidates([attempted, freshA, freshB], attempts, 5000, 10_000),
      [freshA, freshB, attempted]
    )
    // 超出 15 分钟窗口后重新视为未尝试，恢复原顺序。
    assert.deepEqual(
      orderGrokRepairCandidates([attempted, freshA, freshB], attempts, 20_000, 10_000),
      [attempted, freshA, freshB]
    )
  })

  it('detects membership changes but ignores pure reordering', () => {
    assert.equal(grokProviderMembershipChanged(['a', 'b'], ['b', 'a']), false)
    assert.equal(grokProviderMembershipChanged(['a', 'b'], ['a', 'b', 'c']), true)
    assert.equal(grokProviderMembershipChanged(['a'], ['b']), true)
  })
})
