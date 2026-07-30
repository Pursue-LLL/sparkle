import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureCorporateDirectRules, ensureCorporateDnsPolicy } from './corporateDirectRules'

describe('corporateDirectRules', () => {
  it('prepends staff.xdf.cn DIRECT rules before subscription rules', () => {
    const profile = {
      rules: ['IP-CIDR,172.16.0.0/12,🎯 全球直连,no-resolve', 'MATCH,PROXY']
    } as unknown as MihomoConfig

    ensureCorporateDirectRules(profile)

    const rules = profile.rules as string[]
    assert.equal(rules[0], 'DOMAIN,gitlab.staff.xdf.cn,DIRECT')
    assert.equal(rules[1], 'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT')
    assert.equal(rules[2], 'DOMAIN-SUFFIX,staff.neworiental.org,DIRECT')
    assert.equal(rules[3], 'DOMAIN-SUFFIX,koolearn.com,DIRECT')
    assert.equal(rules[4], 'DOMAIN-SUFFIX,neibu.koolearn.com,DIRECT')
    assert.equal(rules[5], 'DOMAIN-KEYWORD,neibu.koolearn.com,DIRECT')
    assert.equal(rules[6], 'IP-CIDR,172.16.0.0/12,🎯 全球直连,no-resolve')
  })

  it('does not duplicate existing corporate rules', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,staff.xdf.cn,DIRECT', 'MATCH,PROXY']
    } as unknown as MihomoConfig

    ensureCorporateDirectRules(profile)

    const rules = profile.rules as string[]
    assert.equal(rules.filter((rule) => rule.includes('staff.xdf.cn')).length, 2)
    assert.equal(rules.filter((rule) => rule.includes('neibu.koolearn.com')).length, 2)
    assert.equal(rules[0], 'DOMAIN,gitlab.staff.xdf.cn,DIRECT')
    assert.equal(rules[1], 'DOMAIN-SUFFIX,staff.neworiental.org,DIRECT')
    assert.equal(rules[2], 'DOMAIN-SUFFIX,koolearn.com,DIRECT')
    assert.equal(rules[3], 'DOMAIN-SUFFIX,neibu.koolearn.com,DIRECT')
    assert.equal(rules[4], 'DOMAIN-KEYWORD,neibu.koolearn.com,DIRECT')
    assert.equal(rules[5], 'DOMAIN-SUFFIX,staff.xdf.cn,DIRECT')
    assert.equal(rules[6], 'MATCH,PROXY')
  })

  it('adds system nameserver policy for corporate intranet domains', () => {
    const profile = {
      dns: { enable: true, 'nameserver-policy': { '+.cursor.sh': ['tls://223.5.5.5'] } }
    } as unknown as MihomoConfig

    ensureCorporateDnsPolicy(profile)

    const policy = (profile.dns as MihomoDNSConfig)['nameserver-policy'] as Record<string, string[]>
    assert.deepEqual(policy['+.neibu.koolearn.com'], ['10.200.150.212', '10.200.150.211'])
    assert.deepEqual(policy['+.koolearn.com'], ['10.200.150.212', '10.200.150.211'])
    assert.deepEqual(policy['+.staff.neworiental.org'], ['system'])
    assert.deepEqual(policy['+.cursor.sh'], ['tls://223.5.5.5'])
  })
})
