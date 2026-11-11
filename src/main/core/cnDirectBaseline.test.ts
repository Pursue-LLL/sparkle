import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureCnDirectBaseline } from './cnDirectBaseline'

function profileWith(rules?: string[]): MihomoConfig {
  return { rules } as unknown as MihomoConfig
}

describe('ensureCnDirectBaseline', () => {
  it('rule-less profile gets the CN direct baseline', () => {
    const profile = profileWith(undefined)

    assert.equal(ensureCnDirectBaseline(profile), true)
    assert.deepEqual(profile.rules, ['GEOSITE,CN,DIRECT', 'GEOIP,CN,DIRECT'])
  })

  it('appends after app-injected rules and before the final MATCH', () => {
    const profile = profileWith([
      'DOMAIN-SUFFIX,opencode.ai,DIRECT',
      'AND,((DstPort,443),(Network,udp)),REJECT',
      'MATCH,🚀 节点选择'
    ])

    assert.equal(ensureCnDirectBaseline(profile), true)
    assert.deepEqual(profile.rules, [
      'DOMAIN-SUFFIX,opencode.ai,DIRECT',
      'AND,((DstPort,443),(Network,udp)),REJECT',
      'GEOSITE,CN,DIRECT',
      'GEOIP,CN,DIRECT',
      'MATCH,🚀 节点选择'
    ])
  })

  it('appends at the end when no MATCH exists yet', () => {
    const profile = profileWith(['DOMAIN-SUFFIX,opencode.ai,DIRECT'])

    ensureCnDirectBaseline(profile)

    assert.deepEqual(profile.rules, [
      'DOMAIN-SUFFIX,opencode.ai,DIRECT',
      'GEOSITE,CN,DIRECT',
      'GEOIP,CN,DIRECT'
    ])
  })

  it('leaves subscriptions that already carry CN geo rules untouched', () => {
    for (const cnRule of [
      'GEOIP,CN,🎯 全球直连',
      'GEOIP,cn,DIRECT,no-resolve',
      'GEOSITE,CN,DIRECT'
    ]) {
      const profile = profileWith(['DOMAIN-SUFFIX,qq.com,DIRECT', cnRule, 'MATCH,🐟 漏网之鱼'])
      const before = [...(profile.rules as string[])]

      assert.equal(ensureCnDirectBaseline(profile), false)
      assert.deepEqual(profile.rules, before)
    }
  })

  it('leaves rule-set based subscriptions untouched', () => {
    const profile = profileWith(['RULE-SET,cncidr,DIRECT', 'MATCH,🚀 节点选择'])

    assert.equal(ensureCnDirectBaseline(profile), false)
    assert.deepEqual(profile.rules, ['RULE-SET,cncidr,DIRECT', 'MATCH,🚀 节点选择'])
  })

  it('does not treat non-CN geo rules as CN awareness', () => {
    const profile = profileWith(['GEOIP,LAN,DIRECT', 'GEOSITE,google,🚀 节点选择'])

    assert.equal(ensureCnDirectBaseline(profile), true)
  })

  it('is idempotent', () => {
    const profile = profileWith(['MATCH,🚀 节点选择'])

    assert.equal(ensureCnDirectBaseline(profile), true)
    assert.equal(ensureCnDirectBaseline(profile), false)
    assert.equal(
      (profile.rules as string[]).filter((rule) => rule.startsWith('GEOIP,CN')).length,
      1
    )
  })
})
