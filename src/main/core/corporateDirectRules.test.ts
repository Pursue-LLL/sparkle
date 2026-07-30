import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureCorporateDirectRules } from './corporateDirectRules'

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
})
