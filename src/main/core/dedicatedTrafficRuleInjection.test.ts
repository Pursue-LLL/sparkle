import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GEMINI_DEDICATED_GROUP_NAME, GROK_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'
import { injectDedicatedTrafficRules } from './dedicatedTrafficRuleInjection'

describe('dedicatedTrafficRuleInjection', () => {
  it('prepends Grok rule to Grok group and X/Stripe rules to HK group', () => {
    const profile = {
      'proxy-groups': [
        { name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' },
        { name: GROK_DEDICATED_GROUP_NAME, type: 'url-test' }
      ],
      rules: [
        'DOMAIN-SUFFIX,x.com,🚀 节点选择',
        'DOMAIN-SUFFIX,grok.com,🤖 OpenAI',
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], `DOMAIN-SUFFIX,grok.com,${GROK_DEDICATED_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`))
    assert.ok(rules.includes(`DOMAIN-KEYWORD,twitter,${HONG_KONG_FILTER_GROUP_NAME}`))
    assert.ok(rules.includes(`DOMAIN-SUFFIX,stripe.com,${HONG_KONG_FILTER_GROUP_NAME}`))
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,example.com,DIRECT')
    assert.ok(
      rules.indexOf(`DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`) <
        rules.indexOf('DOMAIN-SUFFIX,x.com,🚀 节点选择')
    )
  })

  it('prepends Gemini domains to the gemini group ahead of subscription rules', () => {
    const profile = {
      'proxy-groups': [{ name: GEMINI_DEDICATED_GROUP_NAME, type: 'fallback' }],
      rules: [
        'DOMAIN-SUFFIX,gemini.google.com,🤖 OpenAI',
        'DOMAIN-SUFFIX,aistudio.google.com,🌍 国外媒体',
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], `DOMAIN-SUFFIX,gemini.google.com,${GEMINI_DEDICATED_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,aistudio.google.com,${GEMINI_DEDICATED_GROUP_NAME}`))
    assert.ok(
      !rules.some((rule) => rule.startsWith('DOMAIN-SUFFIX,generativelanguage.googleapis.com')),
      'Gemini API stays with the agy group, never shadowed by a dead rule here'
    )
    assert.ok(
      rules.indexOf(`DOMAIN-SUFFIX,gemini.google.com,${GEMINI_DEDICATED_GROUP_NAME}`) <
        rules.indexOf('DOMAIN-SUFFIX,gemini.google.com,🤖 OpenAI')
    )
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,example.com,DIRECT')
  })

  it('leaves Gemini domains untouched while the gemini group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: GROK_DEDICATED_GROUP_NAME, type: 'select' }],
      rules: ['DOMAIN-SUFFIX,gemini.google.com,🤖 OpenAI']
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    assert.deepEqual(profile.rules, [
      `DOMAIN-SUFFIX,grok.com,${GROK_DEDICATED_GROUP_NAME}`,
      'DOMAIN-SUFFIX,gemini.google.com,🤖 OpenAI'
    ])
  })

  it('never routes grok.com to the HK group', () => {
    const profile = {
      'proxy-groups': [
        { name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' },
        { name: GROK_DEDICATED_GROUP_NAME, type: 'url-test' }
      ],
      rules: ['DOMAIN-SUFFIX,grok.com,🤖 OpenAI']
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.ok(rules.includes(`DOMAIN-SUFFIX,grok.com,${GROK_DEDICATED_GROUP_NAME}`))
    assert.ok(!rules.includes(`DOMAIN-SUFFIX,grok.com,${HONG_KONG_FILTER_GROUP_NAME}`))
  })

  it('keeps HK rules pointing at HK while Grok group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' }],
      rules: ['DOMAIN-SUFFIX,grok.com,🤖 OpenAI', 'DOMAIN-SUFFIX,example.com,DIRECT']
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.ok(!rules.some((rule) => rule.endsWith(`,${GROK_DEDICATED_GROUP_NAME}`)))
    assert.ok(rules.includes('DOMAIN-SUFFIX,grok.com,🤖 OpenAI'))
    assert.ok(rules.includes(`DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`))
  })

  it('skips injection when no dedicated group exists', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select' }],
      rules: ['DOMAIN-SUFFIX,x.com,🚀 节点选择']
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    assert.deepEqual(profile.rules, ['DOMAIN-SUFFIX,x.com,🚀 节点选择'])
  })

  it('is idempotent when rules already present', () => {
    const profile = {
      'proxy-groups': [
        { name: HONG_KONG_FILTER_GROUP_NAME, type: 'url-test' },
        { name: GROK_DEDICATED_GROUP_NAME, type: 'url-test' }
      ],
      rules: [
        `DOMAIN-SUFFIX,grok.com,${GROK_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`,
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectDedicatedTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN-SUFFIX,grok.com,${GROK_DEDICATED_GROUP_NAME}`).length,
      1
    )
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN-SUFFIX,x.com,${HONG_KONG_FILTER_GROUP_NAME}`).length,
      1
    )
  })
})
