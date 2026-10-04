import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { injectAntigravityTrafficRules } from './antigravityRuleInjection'

const GENERIC_GOOGLEAPIS_RULE = 'DOMAIN-SUFFIX,googleapis.com,🔍 Google'

describe('antigravityRuleInjection', () => {
  it('prepends cloudcode-pa/aicode/generativelanguage rules above the generic googleapis rule', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'fallback' }],
      rules: [
        GENERIC_GOOGLEAPIS_RULE,
        'DOMAIN,generativelanguage.googleapis.com,🤖 AI',
        'DOMAIN-SUFFIX,cloudcode-pa.googleapis.com,🚀 节点选择',
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], `DOMAIN-KEYWORD,cloudcode-pa,${CURSOR_DEDICATED_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,aicode.googleapis.com,${CURSOR_DEDICATED_GROUP_NAME}`))
    assert.ok(
      rules.includes(
        `DOMAIN-SUFFIX,generativelanguage.googleapis.com,${CURSOR_DEDICATED_GROUP_NAME}`
      )
    )
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,example.com,DIRECT')
    // 关键顺序不变量：专用规则必须先于通用 googleapis 规则命中。
    assert.ok(
      rules.indexOf(`DOMAIN-KEYWORD,cloudcode-pa,${CURSOR_DEDICATED_GROUP_NAME}`) <
        rules.indexOf(GENERIC_GOOGLEAPIS_RULE)
    )
    assert.ok(
      rules.indexOf(
        `DOMAIN-SUFFIX,generativelanguage.googleapis.com,${CURSOR_DEDICATED_GROUP_NAME}`
      ) < rules.indexOf('DOMAIN,generativelanguage.googleapis.com,🤖 AI')
    )
  })

  it('skips injection when the 🎯 Cursor 专用 group is absent (safe degrade)', () => {
    const profile = {
      'proxy-groups': [
        { name: '自动选择', type: 'fallback' },
        { name: '🔍 Google', type: 'select' }
      ],
      rules: [GENERIC_GOOGLEAPIS_RULE]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    assert.deepEqual(profile.rules, [GENERIC_GOOGLEAPIS_RULE])
  })

  it('is idempotent when the rules are already present', () => {
    const profile = {
      'proxy-groups': [{ name: CURSOR_DEDICATED_GROUP_NAME, type: 'fallback' }],
      rules: [
        `DOMAIN-KEYWORD,cloudcode-pa,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,aicode.googleapis.com,${CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,generativelanguage.googleapis.com,${CURSOR_DEDICATED_GROUP_NAME}`,
        GENERIC_GOOGLEAPIS_RULE
      ]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules.length, 4)
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN-KEYWORD,cloudcode-pa,${CURSOR_DEDICATED_GROUP_NAME}`)
        .length,
      1
    )
    assert.equal(rules[3], GENERIC_GOOGLEAPIS_RULE)
  })
})
