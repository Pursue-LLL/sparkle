import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildTieredFakeIpFilter,
  collectTier1FakeIpFilterEntries,
  ensureFakeIpRoutingIntegrity,
  sanitizeFakeIpDirectCidrRules,
  TIER0_FAKE_IP_FILTER
} from './fakeIpRoutingIntegrity'

describe('fakeIpRoutingIntegrity', () => {
  it('removes fake-ip CIDR direct trap rules', () => {
    const profile = {
      dns: { enable: true, 'enhanced-mode': 'fake-ip' },
      profile: { 'store-fake-ip': true },
      rules: [
        'DOMAIN-SUFFIX,cloudflare.com,🚀 节点选择',
        'IP-CIDR,198.18.0.0/16,🎯 全球直连,no-resolve',
        'GEOIP,CN,🎯 全球直连',
        'MATCH,🐟 漏网之鱼'
      ]
    } as unknown as MihomoConfig

    const removed = sanitizeFakeIpDirectCidrRules(profile)
    const rules = profile.rules as string[]

    assert.equal(removed, 1)
    assert.equal(rules.some((rule) => rule.includes('198.18.0.0/16')), false)
    assert.equal(rules.length, 3)
  })

  it('collects tier1 suffixes selectively without TLD-only rules', () => {
    const entries = collectTier1FakeIpFilterEntries([
      'DOMAIN-SUFFIX,cloudflare.com,🚀 节点选择',
      'DOMAIN-SUFFIX,.ai,🚀 节点选择',
      'DOMAIN-SUFFIX,.org,🚀 节点选择',
      'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT',
      'DOMAIN,api2.cursor.sh,🎯 Cursor-专用'
    ])

    assert.ok(entries.includes('+.cloudflare.com'))
    assert.ok(entries.includes('api2.cursor.sh'))
    assert.equal(entries.some((entry) => entry === '+.ai'), false)
    assert.equal(entries.some((entry) => entry.includes('staff.xdf.cn')), false)
  })

  it('builds tiered filter with tier0 always present', () => {
    const filter = buildTieredFakeIpFilter({
      existing: ['+.lan'],
      rules: ['DOMAIN-SUFFIX,cloudflare.com,🚀 节点选择'],
      includeTier1: true
    })

    assert.ok(filter.includes('+.lan'))
    for (const entry of TIER0_FAKE_IP_FILTER) {
      assert.ok(filter.includes(entry))
    }
    assert.ok(filter.includes('+.cloudflare.com'))
  })

  it('tier1 stays bounded on a large subscription-like ruleset', () => {
    const rules: string[] = []
    for (let index = 0; index < 2000; index += 1) {
      rules.push(`DOMAIN-SUFFIX,service-${index}.example.com,🚀 节点选择`)
    }
    rules.push('DOMAIN-SUFFIX,.ai,🚀 节点选择')

    const entries = collectTier1FakeIpFilterEntries(rules)
    assert.equal(entries.length, 2000)
    assert.ok(entries.every((entry) => entry.startsWith('+.service-')))
  })

  it('ensure applies layer1 sniffer integrity and tier0 filter only', () => {
    const profile = {
      dns: {
        enable: true,
        'enhanced-mode': 'fake-ip',
        'fake-ip-filter': ['+.lan']
      },
      profile: { 'store-fake-ip': true },
      sniffer: { enable: true, 'parse-pure-ip': false },
      rules: [
        'DOMAIN-SUFFIX,cloudflare.com,🚀 节点选择',
        'IP-CIDR,198.18.0.0/16,🎯 全球直连,no-resolve'
      ]
    } as unknown as MihomoConfig

    const result = ensureFakeIpRoutingIntegrity(profile)

    assert.equal(result.removedFakeIpCidrRules, 1)
    assert.ok(result.fakeIpFilterCount < 32)
    assert.equal((profile.sniffer as MihomoSnifferConfig)['force-dns-mapping'], true)
    assert.equal((profile.sniffer as MihomoSnifferConfig)['parse-pure-ip'], true)
    const filter = (profile.dns as MihomoDNSConfig)['fake-ip-filter'] ?? []
    assert.ok(filter.includes('+.lan'))
    assert.ok(filter.includes('+.cursor.sh'))
    assert.equal(filter.includes('+.cloudflare.com'), false)
  })
})
