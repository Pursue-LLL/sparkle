import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'
import { injectHongKongTrafficRules } from './hongKongTrafficRuleInjection'

describe('hongKongTrafficRuleInjection', () => {
  it('prepends X/Twitter/Grok/Stripe rules when HK group exists', () => {
    const profile = {
      'proxy-groups': [{ name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' }],
      rules: [
        'DOMAIN-SUFFIX,x.com,🚀 节点选择',
        'DOMAIN-SUFFIX,grok.com,🤖 OpenAI',
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectHongKongTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], `DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`)
    assert.equal(rules[1], `DOMAIN-KEYWORD,twitter,${HONG_KONG_FILTER_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,grok.com,${HONG_KONG_FILTER_GROUP_NAME}`))
    assert.ok(rules.includes(`DOMAIN-SUFFIX,stripe.com,${HONG_KONG_FILTER_GROUP_NAME}`))
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,example.com,DIRECT')
    assert.ok(rules.indexOf(`DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`) < rules.indexOf('DOMAIN-SUFFIX,x.com,🚀 节点选择'))
  })

  it('skips injection when HK group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select' }],
      rules: ['DOMAIN-SUFFIX,x.com,🚀 节点选择']
    } as unknown as MihomoConfig

    injectHongKongTrafficRules(profile)

    assert.deepEqual(profile.rules, ['DOMAIN-SUFFIX,x.com,🚀 节点选择'])
  })

  it('is idempotent when HK rules already present', () => {
    const profile = {
      'proxy-groups': [{ name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' }],
      rules: [`DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`, 'DOMAIN-SUFFIX,example.com,DIRECT']
    } as unknown as MihomoConfig

    injectHongKongTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`).length,
      1
    )
  })
})
