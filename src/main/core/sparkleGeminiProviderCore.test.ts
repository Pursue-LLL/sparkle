import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { GeminiRegionProbeCache, GeminiRegionProbeRecord } from './sparkleGeminiProbeCore'
import {
  buildGeminiGroupConfig,
  buildSparkleGeminiProviderDocument,
  geminiHeadUpgradeAvailable,
  geminiProviderMembershipChanged,
  GEMINI_NODE_PROVIDER_ID,
  GEMINI_POOL_MAX_SIZE,
  orderGeminiProxies,
  type GeminiProxyRecord,
  type GeminiStabilityView
} from './sparkleGeminiProviderCore'
import {
  STABLE_CLEAN_WINDOW_MS,
  STABLE_MIN_SAMPLES,
  type GeminiStabilityEntry
} from './sparkleGeminiStabilityCore'

const NOW = 1_700_000_000_000
const STABLE: GeminiStabilityEntry = { samples: STABLE_MIN_SAMPLES }

function node(name: string, server = 'example.com'): GeminiProxyRecord {
  return { name, type: 'vless', server, port: 443 }
}

function stabilityOf(
  entries: Array<[name: string, entry: GeminiStabilityEntry]>
): GeminiStabilityView {
  return { ledger: new Map(entries), nowMs: NOW }
}

function cacheOf(
  entries: Array<{ proxy: GeminiProxyRecord; eligible: boolean; countryCode: string }>
): GeminiRegionProbeCache {
  const map = new Map<string, GeminiRegionProbeRecord>()
  for (const entry of entries) {
    map.set(computeProxyNodeFingerprint(entry.proxy), {
      eligible: entry.eligible,
      countryCode: entry.countryCode,
      checkedAt: Date.now()
    })
  }
  return map
}

const namesOf = (proxies: readonly GeminiProxyRecord[]): string[] =>
  proxies.map((proxy) => String(proxy.name))

describe('sparkleGeminiProviderCore', () => {
  it('keeps only region-verified nodes once any node is verified', () => {
    const taiwan = node('台湾 01')
    const japan = node('日本 01')
    const korea = node('韩国 01')
    const cache = cacheOf([
      { proxy: taiwan, eligible: true, countryCode: 'TW' },
      { proxy: japan, eligible: false, countryCode: 'ZZ' }
    ])

    assert.deepEqual(namesOf(orderGeminiProxies([taiwan, japan, korea], ['台湾'], cache)), [
      '台湾 01'
    ])
  })

  it('falls back to not-confirmed-blocked nodes while nothing is verified yet', () => {
    const taiwan = node('台湾 01')
    const japan = node('日本 01')
    const hongKong = node('香港 01')
    const cache = cacheOf([{ proxy: hongKong, eligible: false, countryCode: 'HK' }])

    assert.deepEqual(
      namesOf(orderGeminiProxies([hongKong, japan, taiwan], ['台湾', '日本'], cache)),
      ['台湾 01', '日本 01']
    )
  })

  it('never returns an empty pool while the subscription has nodes', () => {
    const taiwan = node('台湾 01')
    const japan = node('日本 01')
    const cache = cacheOf([
      { proxy: taiwan, eligible: false, countryCode: 'CN' },
      { proxy: japan, eligible: false, countryCode: 'ZZ' }
    ])

    assert.deepEqual(namesOf(orderGeminiProxies([taiwan, japan], ['台湾'], cache)), [
      '台湾 01',
      '日本 01'
    ])
    assert.deepEqual(orderGeminiProxies([], ['台湾'], cache), [])
  })

  it('orders verified nodes by region priority, then measured delay', () => {
    const slowTaiwan = node('台湾 02', 'tw2.example.com')
    const fastTaiwan = node('台湾 01', 'tw1.example.com')
    const japan = node('日本 01')
    const america = node('美国 01')
    const cache = cacheOf([
      { proxy: slowTaiwan, eligible: true, countryCode: 'TW' },
      { proxy: fastTaiwan, eligible: true, countryCode: 'TW' },
      { proxy: japan, eligible: true, countryCode: 'JP' },
      { proxy: america, eligible: true, countryCode: 'US' }
    ])
    const delays = new Map<string, number>([
      ['台湾 02', 400],
      ['台湾 01', 120],
      ['日本 01', 60],
      ['美国 01', 30]
    ])

    assert.deepEqual(
      namesOf(
        orderGeminiProxies(
          [america, slowTaiwan, japan, fastTaiwan],
          ['台湾', '日本'],
          cache,
          delays
        )
      ),
      ['台湾 01', '台湾 02', '日本 01', '美国 01']
    )
  })

  it(`caps the pool at ${GEMINI_POOL_MAX_SIZE} verified nodes`, () => {
    const proxies = Array.from({ length: GEMINI_POOL_MAX_SIZE + 3 }, (_, index) =>
      node(`台湾 ${String(index + 1).padStart(2, '0')}`, `tw${index}.example.com`)
    )
    const cache = cacheOf(proxies.map((proxy) => ({ proxy, eligible: true, countryCode: 'TW' })))

    const ordered = orderGeminiProxies(proxies, ['台湾'], cache)

    assert.equal(ordered.length, GEMINI_POOL_MAX_SIZE)
    assert.deepEqual(namesOf(ordered), namesOf(proxies.slice(0, GEMINI_POOL_MAX_SIZE)))
  })

  describe('stability tiers', () => {
    const taiwan = node('台湾 01', 'tw.example.com')
    const taiwanFast = node('台湾 02', 'tw2.example.com')
    const japan = node('日本 01', 'jp.example.com')
    const korea = node('韩国 01', 'kr.example.com')
    const eligible = (...proxies: GeminiProxyRecord[]): GeminiRegionProbeCache =>
      cacheOf(proxies.map((proxy) => ({ proxy, eligible: true, countryCode: 'TW' })))

    it('puts a proven node ahead of a higher-priority region that is still unproven', () => {
      const ordered = orderGeminiProxies(
        [taiwan, japan],
        ['台湾', '日本'],
        eligible(taiwan, japan),
        undefined,
        stabilityOf([['日本 01', STABLE]])
      )

      assert.deepEqual(namesOf(ordered), ['日本 01', '台湾 01'])
    })

    it('still follows region priority, then delay, inside each tier', () => {
      const delays = new Map([
        ['台湾 01', 300],
        ['台湾 02', 100],
        ['日本 01', 50],
        ['韩国 01', 40]
      ])

      const ordered = orderGeminiProxies(
        [taiwan, taiwanFast, japan, korea],
        ['台湾', '日本', '韩国'],
        eligible(taiwan, taiwanFast, japan, korea),
        delays,
        stabilityOf([
          ['台湾 01', STABLE],
          ['日本 01', STABLE]
        ])
      )

      assert.deepEqual(namesOf(ordered), ['台湾 01', '日本 01', '台湾 02', '韩国 01'])
    })

    it('does not trust a node that was blocked inside the clean window, and trusts it again after', () => {
      const recent = { samples: 50, lastBadAt: NOW - STABLE_CLEAN_WINDOW_MS + 1 }
      const healed = { samples: 50, lastBadAt: NOW - STABLE_CLEAN_WINDOW_MS }
      const cache = eligible(taiwan, japan)

      assert.deepEqual(
        namesOf(
          orderGeminiProxies(
            [taiwan, japan],
            ['台湾', '日本'],
            cache,
            undefined,
            stabilityOf([['台湾 01', recent]])
          )
        ),
        ['台湾 01', '日本 01'],
        'nobody is proven, so the region priority decides'
      )
      assert.deepEqual(
        namesOf(
          orderGeminiProxies(
            [taiwan, japan],
            ['台湾', '日本'],
            cache,
            undefined,
            stabilityOf([
              ['台湾 01', recent],
              ['日本 01', STABLE]
            ])
          )
        ),
        ['日本 01', '台湾 01']
      )
      assert.deepEqual(
        namesOf(
          orderGeminiProxies(
            [taiwan, japan],
            ['台湾', '日本'],
            cache,
            undefined,
            stabilityOf([
              ['台湾 01', healed],
              ['日本 01', STABLE]
            ])
          )
        ),
        ['台湾 01', '日本 01']
      )
    })

    it('never lets a proven node past the region verdict: blocked or unverified stays out', () => {
      const blocked = cacheOf([
        { proxy: japan, eligible: false, countryCode: 'ZZ' },
        { proxy: taiwan, eligible: true, countryCode: 'TW' }
      ])

      const ordered = orderGeminiProxies(
        [japan, taiwan, korea],
        ['日本'],
        blocked,
        undefined,
        stabilityOf([
          ['日本 01', STABLE],
          ['韩国 01', STABLE]
        ])
      )

      assert.deepEqual(namesOf(ordered), ['台湾 01'])
    })

    it('fills the capped pool with proven nodes first', () => {
      const proxies = Array.from({ length: GEMINI_POOL_MAX_SIZE + 3 }, (_, index) =>
        node(`台湾 ${String(index + 1).padStart(2, '0')}`, `tw${index}.example.com`)
      )
      const lastThree = proxies.slice(-3)

      const ordered = orderGeminiProxies(
        proxies,
        ['台湾'],
        eligible(...proxies),
        undefined,
        stabilityOf(lastThree.map((proxy) => [String(proxy.name), STABLE]))
      )

      assert.equal(ordered.length, GEMINI_POOL_MAX_SIZE)
      assert.deepEqual(namesOf(ordered).slice(0, 3), namesOf(lastThree))
    })

    it('keeps an empty ledger equivalent to no ledger at all', () => {
      const cache = eligible(taiwan, japan)

      assert.deepEqual(
        orderGeminiProxies([japan, taiwan], ['台湾'], cache, undefined, stabilityOf([])),
        orderGeminiProxies([japan, taiwan], ['台湾'], cache)
      )
    })

    it('carries the ledger through the provider document', () => {
      const doc = buildSparkleGeminiProviderDocument({
        proxies: [taiwan, japan],
        regionPriority: ['台湾'],
        regionCache: eligible(taiwan, japan),
        stability: stabilityOf([['日本 01', STABLE]])
      })

      assert.deepEqual(namesOf(doc.proxies), ['日本 01', '台湾 01'])
    })
  })

  it('dedupes by name and drops nameless nodes', () => {
    const taiwan = node('台湾 01')

    assert.deepEqual(
      namesOf(
        buildSparkleGeminiProviderDocument({
          proxies: [taiwan, { ...taiwan }, { type: 'vless', server: 'x.example.com', port: 1 }],
          regionPriority: ['台湾']
        }).proxies
      ),
      ['台湾 01']
    )
  })

  it('detects membership changes by set, not by order', () => {
    assert.equal(geminiProviderMembershipChanged(['A', 'B'], ['B', 'A']), false)
    assert.equal(geminiProviderMembershipChanged(['A'], ['A', 'B']), true)
    assert.equal(geminiProviderMembershipChanged(['A', 'B'], ['A', 'C']), true)
    assert.equal(geminiProviderMembershipChanged([], []), false)
  })

  it('upgrades the head only from an unstable node to a stable one', () => {
    const stable = (name: string): boolean => name.startsWith('稳')

    assert.equal(geminiHeadUpgradeAvailable(['台湾', '稳日'], ['稳日', '台湾'], stable), true)
    assert.equal(
      geminiHeadUpgradeAvailable(['稳日', '稳韩'], ['稳韩', '稳日'], stable),
      false,
      'stable to stable is delay jitter'
    )
    assert.equal(geminiHeadUpgradeAvailable(['稳日', '台湾'], ['台湾', '稳日'], stable), false)
    assert.equal(geminiHeadUpgradeAvailable(['台湾', '美国'], ['美国', '台湾'], stable), false)
    assert.equal(geminiHeadUpgradeAvailable(['台湾', '稳日'], ['台湾', '稳日'], stable), false)
    assert.equal(geminiHeadUpgradeAvailable([], ['稳日'], stable), false)
    assert.equal(geminiHeadUpgradeAvailable(['台湾'], [], stable), false)
  })

  it('builds a fallback group over the gemini provider in provider mode', () => {
    const group = buildGeminiGroupConfig(['台湾 01'], 'profile-1')

    assert.equal(group?.name, GEMINI_DEDICATED_GROUP_NAME)
    assert.equal(group?.type, 'fallback')
    assert.deepEqual(group?.use, [GEMINI_NODE_PROVIDER_ID])
    assert.equal(group?.url, 'https://www.gstatic.com/generate_204')
    assert.equal(group?.lazy, true)
    assert.equal(buildGeminiGroupConfig([], 'profile-1'), null)
  })

  it('builds a fallback group from inline leaves without a provider', () => {
    const group = buildGeminiGroupConfig(['台湾 01', '日本 01', '台湾 01'], undefined)

    assert.equal(group?.name, GEMINI_DEDICATED_GROUP_NAME)
    assert.equal(group?.type, 'fallback')
    assert.deepEqual(group?.proxies, ['台湾 01', '日本 01'])
    assert.equal(buildGeminiGroupConfig([], undefined), null)
  })
})
