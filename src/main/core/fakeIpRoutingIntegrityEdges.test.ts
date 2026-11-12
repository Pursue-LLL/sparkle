import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applySnifferIntegrityPatch,
  buildTieredFakeIpFilter,
  collectTier0DirectFakeIpFilterEntries,
  collectTier1FakeIpFilterEntries,
  ensureFakeIpRoutingIntegrity,
  mergeFakeIpFilterEntries,
  sanitizeFakeIpDirectCidrRules,
  TIER0_DIRECT_CN_SUFFIXES,
  TIER0_FAKE_IP_FILTER
} from './fakeIpRoutingIntegrity'

const FAKE_IP_DNS = { enable: true, 'enhanced-mode': 'fake-ip' }
const CIDR_TRAP = 'IP-CIDR,198.18.0.0/16,DIRECT,no-resolve'

function profileOf(parts: Record<string, unknown>): MihomoConfig {
  return parts as unknown as MihomoConfig
}

const proxyEntries = (...rules: string[]): string[] => collectTier1FakeIpFilterEntries(rules)
const directEntries = (...rules: string[]): string[] =>
  collectTier0DirectFakeIpFilterEntries(rules).filter(
    (entry) => !(TIER0_DIRECT_CN_SUFFIXES as readonly string[]).includes(entry)
  )

describe('fake-ip filter entries', () => {
  it('turns DOMAIN rules into exact hosts and DOMAIN-SUFFIX rules into wildcards', () => {
    assert.deepEqual(
      proxyEntries(
        'DOMAIN,api.example.com,PROXY',
        'DOMAIN-SUFFIX,example.org,PROXY',
        'DOMAIN-SUFFIX,.example.net,PROXY'
      ),
      ['+.example.net', '+.example.org', 'api.example.com']
    )
  })

  it('keeps a leading dot on a DOMAIN payload only when two labels remain', () => {
    assert.deepEqual(proxyEntries('DOMAIN,.example.com,PROXY'), ['+.example.com'])
    assert.deepEqual(proxyEntries('DOMAIN,.com,PROXY', 'DOMAIN,.,PROXY'), [])
  })

  it('never turns a single-label suffix into a wildcard', () => {
    assert.deepEqual(
      proxyEntries(
        'DOMAIN-SUFFIX,com,PROXY',
        'DOMAIN-SUFFIX,.com,PROXY',
        'DOMAIN-SUFFIX,.ai,PROXY',
        'DOMAIN-SUFFIX,.,PROXY'
      ),
      []
    )
  })

  it('ignores blank payloads', () => {
    assert.deepEqual(proxyEntries('DOMAIN,   ,PROXY', 'DOMAIN-SUFFIX,   ,PROXY'), [])
  })

  it('trims payloads and reads domains nested in logical rules', () => {
    assert.deepEqual(
      proxyEntries(
        'DOMAIN-SUFFIX, example.com ,PROXY',
        'AND,((DOMAIN,a.example.net),(NETWORK,UDP)),PROXY',
        'OR,((DOMAIN-SUFFIX,b.example.org),(DOMAIN,c.example.org)),PROXY'
      ),
      ['+.b.example.org', '+.example.com', 'a.example.net', 'c.example.org']
    )
  })

  it('leaves every other rule type alone', () => {
    assert.deepEqual(
      proxyEntries(
        'DOMAIN-KEYWORD,example,PROXY',
        'DOMAIN-REGEX,^a\\.example\\.com$,PROXY',
        'GEOSITE,google,PROXY',
        'IP-CIDR,1.1.1.1/32,PROXY',
        'MATCH,PROXY'
      ),
      []
    )
  })

  it('skips comments, blanks and rules that name no target', () => {
    const rules = ['# DOMAIN-SUFFIX,a.example.com,PROXY', '', 'DOMAIN-SUFFIX,a.example.com']

    assert.deepEqual(proxyEntries(...rules), [])
    assert.deepEqual(directEntries(...rules), [])
  })

  it('sorts and de-duplicates what it collects', () => {
    assert.deepEqual(
      proxyEntries(
        'DOMAIN-SUFFIX,b.example.com,PROXY',
        'DOMAIN-SUFFIX,a.example.com,PROXY',
        'DOMAIN-SUFFIX,b.example.com,OTHER'
      ),
      ['+.a.example.com', '+.b.example.com']
    )
  })

  it('has only the built-in defaults to offer when there are no rules', () => {
    const defaults = [...TIER0_DIRECT_CN_SUFFIXES].sort()

    assert.deepEqual(collectTier0DirectFakeIpFilterEntries(undefined), defaults)
    assert.deepEqual(collectTier0DirectFakeIpFilterEntries([]), defaults)
    assert.deepEqual(collectTier1FakeIpFilterEntries(undefined), [])
    assert.deepEqual(collectTier1FakeIpFilterEntries([]), [])
  })
})

describe('which rules say a host should be reached directly', () => {
  const DIRECT_INTENT = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', '🎯 全球直连', '🛑 全球拦截']
  const PROXY_INTENT = ['🚀 节点选择', 'Proxy', '自动选择']

  it('sends the hosts of direct, rejecting and built-in targets to tier 0', () => {
    for (const target of DIRECT_INTENT) {
      const rule = `DOMAIN-SUFFIX,site.example.com,${target}`

      assert.deepEqual(directEntries(rule), ['+.site.example.com'], target)
      assert.deepEqual(proxyEntries(rule), [], target)
    }
  })

  it('sends the hosts of proxy targets to tier 1 only', () => {
    for (const target of PROXY_INTENT) {
      const rule = `DOMAIN-SUFFIX,site.example.com,${target}`

      assert.deepEqual(proxyEntries(rule), ['+.site.example.com'], target)
      assert.deepEqual(directEntries(rule), [], target)
    }
  })

  it('reads the target in front of no-resolve and ignores stray spaces', () => {
    const rule = 'DOMAIN-SUFFIX,site.example.com , DIRECT ,no-resolve'

    assert.deepEqual(directEntries(rule), ['+.site.example.com'])
    assert.deepEqual(proxyEntries(rule), [])
  })
})

describe('mergeFakeIpFilterEntries and buildTieredFakeIpFilter', () => {
  it('keeps the existing entries first and drops duplicates', () => {
    assert.deepEqual(mergeFakeIpFilterEntries(['a', 'b'], ['b', 'c', 'c']), ['a', 'b', 'c'])
    assert.deepEqual(mergeFakeIpFilterEntries(undefined, ['x', 'x']), ['x'])
  })

  it('layers existing, Cursor, direct and proxy entries in that order', () => {
    const rules = ['DOMAIN-SUFFIX,corp.example.com,DIRECT', 'DOMAIN-SUFFIX,cloud.example.com,PROXY']

    assert.deepEqual(buildTieredFakeIpFilter({ existing: ['+.lan'], rules }), [
      '+.lan',
      ...TIER0_FAKE_IP_FILTER,
      ...collectTier0DirectFakeIpFilterEntries(rules),
      '+.cloud.example.com'
    ])
  })

  it('leaves the proxy tier out only when asked to', () => {
    const rules = ['DOMAIN-SUFFIX,cloud.example.com,PROXY']

    assert.ok(buildTieredFakeIpFilter({ rules }).includes('+.cloud.example.com'))
    assert.ok(
      buildTieredFakeIpFilter({ rules, includeTier1: true }).includes('+.cloud.example.com')
    )
    assert.equal(
      buildTieredFakeIpFilter({ rules, includeTier1: false }).includes('+.cloud.example.com'),
      false
    )
  })

  it('still builds the fixed tiers from nothing', () => {
    assert.deepEqual(buildTieredFakeIpFilter({}), [
      ...TIER0_FAKE_IP_FILTER,
      ...[...TIER0_DIRECT_CN_SUFFIXES].sort()
    ])
  })
})

describe('sanitizeFakeIpDirectCidrRules', () => {
  it('drops only the two fake-ip ranges, whatever they point at', () => {
    const profile = profileOf({
      dns: FAKE_IP_DNS,
      rules: [
        'IP-CIDR,198.18.0.0/16,DIRECT',
        'IP-CIDR, 198.19.0.0/16 ,🎯 Direct,no-resolve',
        'IP-CIDR,198.18.0.0/15,DIRECT',
        'IP-CIDR,10.0.0.0/8,DIRECT',
        'IP-CIDR6,fc00::/7,DIRECT',
        'IP-CIDR,,DIRECT',
        'SRC-IP-CIDR,198.18.0.0/16,DIRECT',
        'DOMAIN,198.18.0.0/16,DIRECT',
        '# IP-CIDR,198.18.0.0/16,DIRECT'
      ]
    })

    assert.equal(sanitizeFakeIpDirectCidrRules(profile), 2)
    assert.deepEqual(profile.rules, [
      'IP-CIDR,198.18.0.0/15,DIRECT',
      'IP-CIDR,10.0.0.0/8,DIRECT',
      'IP-CIDR6,fc00::/7,DIRECT',
      'IP-CIDR,,DIRECT',
      'SRC-IP-CIDR,198.18.0.0/16,DIRECT',
      'DOMAIN,198.18.0.0/16,DIRECT',
      '# IP-CIDR,198.18.0.0/16,DIRECT'
    ])
  })

  it('leaves the very same rule list in place when nothing matches', () => {
    const rules = ['DOMAIN,example.com,DIRECT', 'MATCH,DIRECT']
    const profile = profileOf({ dns: FAKE_IP_DNS, rules })

    assert.equal(sanitizeFakeIpDirectCidrRules(profile), 0)
    assert.equal(profile.rules, rules)
  })

  it('does nothing when there are no rules to look at', () => {
    assert.equal(sanitizeFakeIpDirectCidrRules(profileOf({ dns: FAKE_IP_DNS })), 0)
    assert.equal(sanitizeFakeIpDirectCidrRules(profileOf({ dns: FAKE_IP_DNS, rules: [] })), 0)
  })

  it('does nothing while fake-ip is not in charge of DNS', () => {
    const inactive: Record<string, unknown>[] = [
      {},
      { dns: { 'enhanced-mode': 'fake-ip' } },
      { dns: { enable: false, 'enhanced-mode': 'fake-ip' } },
      { dns: { enable: true } },
      { dns: { enable: true, 'enhanced-mode': 'redir-host' } },
      { dns: FAKE_IP_DNS, profile: { 'store-fake-ip': false } }
    ]

    for (const parts of inactive) {
      const rules = [CIDR_TRAP]
      const profile = profileOf({ ...parts, rules })

      assert.equal(sanitizeFakeIpDirectCidrRules(profile), 0, JSON.stringify(parts))
      assert.equal(profile.rules, rules, JSON.stringify(parts))
    }
  })

  it('stays active when store-fake-ip is set or left out', () => {
    for (const storage of [undefined, { 'store-fake-ip': true }]) {
      const profile = profileOf({ dns: FAKE_IP_DNS, profile: storage, rules: [CIDR_TRAP] })

      assert.equal(sanitizeFakeIpDirectCidrRules(profile), 1)
      assert.deepEqual(profile.rules, [])
    }
  })
})

describe('applySnifferIntegrityPatch', () => {
  it('builds a complete sniffer section from nothing', () => {
    assert.deepEqual(applySnifferIntegrityPatch(undefined), {
      enable: true,
      'parse-pure-ip': true,
      'force-dns-mapping': true,
      'override-destination': false
    })
  })

  it('forces the mapping switches, keeps the rest and respects an explicit enable', () => {
    const patched = applySnifferIntegrityPatch({
      enable: false,
      'parse-pure-ip': false,
      'force-dns-mapping': false,
      'override-destination': true,
      'force-domain': ['+.example.com']
    } as MihomoSnifferConfig)

    assert.deepEqual(patched, {
      enable: false,
      'parse-pure-ip': true,
      'force-dns-mapping': true,
      'override-destination': true,
      'force-domain': ['+.example.com']
    })
  })
})

describe('ensureFakeIpRoutingIntegrity', () => {
  it('leaves an inactive profile alone and reports the filter it already has', () => {
    const filter = ['+.lan', '+.local']
    const profile = profileOf({
      dns: { enable: true, 'enhanced-mode': 'redir-host', 'fake-ip-filter': filter },
      sniffer: { enable: true },
      rules: [CIDR_TRAP]
    })

    assert.deepEqual(ensureFakeIpRoutingIntegrity(profile), {
      removedFakeIpCidrRules: 0,
      fakeIpFilterCount: 2
    })
    assert.equal((profile.dns as MihomoDNSConfig)['fake-ip-filter'], filter)
    assert.deepEqual(profile.sniffer, { enable: true })
    assert.deepEqual(profile.rules, [CIDR_TRAP])
  })

  it('reports an empty filter for an inactive profile without DNS settings', () => {
    assert.deepEqual(ensureFakeIpRoutingIntegrity(profileOf({})), {
      removedFakeIpCidrRules: 0,
      fakeIpFilterCount: 0
    })
  })

  it('counts the filter it builds for an active profile', () => {
    const profile = profileOf({ dns: FAKE_IP_DNS, rules: [CIDR_TRAP, 'MATCH,DIRECT'] })

    const result = ensureFakeIpRoutingIntegrity(profile)

    const filter = (profile.dns as MihomoDNSConfig)['fake-ip-filter']
    assert.equal(result.removedFakeIpCidrRules, 1)
    assert.equal(result.fakeIpFilterCount, filter?.length)
    assert.deepEqual(
      filter,
      buildTieredFakeIpFilter({ rules: ['MATCH,DIRECT'], includeTier1: false })
    )
  })

  it('does not switch a sniffer on that was turned off on purpose', () => {
    const sniffer = { enable: false, 'parse-pure-ip': false }
    const profile = profileOf({ dns: FAKE_IP_DNS, sniffer: { ...sniffer }, rules: [] })

    ensureFakeIpRoutingIntegrity(profile)

    assert.deepEqual(profile.sniffer, sniffer)
  })

  it('adds the sniffer settings when the profile has none', () => {
    const profile = profileOf({ dns: FAKE_IP_DNS, rules: [] })

    ensureFakeIpRoutingIntegrity(profile)

    assert.deepEqual(profile.sniffer, applySnifferIntegrityPatch(undefined))
  })
})
