import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type {
  GeminiRegionProbeCache,
  GeminiRegionProbeRecord
} from './sparkleGeminiProbeCore'
import {
  buildGeminiGroupConfig,
  buildSparkleGeminiProviderDocument,
  geminiProviderMembershipChanged,
  GEMINI_NODE_PROVIDER_ID,
  GEMINI_POOL_MAX_SIZE,
  orderGeminiProxies,
  type GeminiProxyRecord
} from './sparkleGeminiProviderCore'

function node(name: string, server = 'example.com'): GeminiProxyRecord {
  return { name, type: 'vless', server, port: 443 }
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
        orderGeminiProxies([america, slowTaiwan, japan, fastTaiwan], ['台湾', '日本'], cache, delays)
      ),
      ['台湾 01', '台湾 02', '日本 01', '美国 01']
    )
  })

  it(`caps the pool at ${GEMINI_POOL_MAX_SIZE} verified nodes`, () => {
    const proxies = Array.from({ length: GEMINI_POOL_MAX_SIZE + 3 }, (_, index) =>
      node(`台湾 ${String(index + 1).padStart(2, '0')}`, `tw${index}.example.com`)
    )
    const cache = cacheOf(
      proxies.map((proxy) => ({ proxy, eligible: true, countryCode: 'TW' }))
    )

    const ordered = orderGeminiProxies(proxies, ['台湾'], cache)

    assert.equal(ordered.length, GEMINI_POOL_MAX_SIZE)
    assert.deepEqual(namesOf(ordered), namesOf(proxies.slice(0, GEMINI_POOL_MAX_SIZE)))
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
