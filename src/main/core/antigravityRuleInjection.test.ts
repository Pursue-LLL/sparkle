import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AGY_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_GROUP_NAME } from './defaultAutoSwitchProxy'
import { injectAntigravityTrafficRules } from './antigravityRuleInjection'

const GENERIC_GOOGLEAPIS_RULE = 'DOMAIN-SUFFIX,googleapis.com,🔍 Google'
const AGY_GROUP = { name: AGY_DEDICATED_GROUP_NAME, type: 'select' }
const AUTO_GROUP = { name: AUTO_SELECT_GROUP_NAME, type: 'fallback' }

function rulesOf(profile: MihomoConfig): string[] {
  return (profile.rules as string[]) ?? []
}

describe('antigravityRuleInjection', () => {
  it('routes cloudcode-pa/aicode/generativelanguage into the agy dedicated group when present', () => {
    const profile = {
      'proxy-groups': [AGY_GROUP, AUTO_GROUP],
      rules: [
        GENERIC_GOOGLEAPIS_RULE,
        'DOMAIN,generativelanguage.googleapis.com,🤖 AI',
        'DOMAIN-SUFFIX,cloudcode-pa.googleapis.com,🚀 节点选择',
        'DOMAIN-SUFFIX,example.com,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = rulesOf(profile)
    assert.equal(rules[0], `DOMAIN-KEYWORD,cloudcode-pa,${AGY_DEDICATED_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,aicode.googleapis.com,${AGY_DEDICATED_GROUP_NAME}`))
    assert.ok(
      rules.includes(`DOMAIN-SUFFIX,generativelanguage.googleapis.com,${AGY_DEDICATED_GROUP_NAME}`)
    )
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,example.com,DIRECT')
    // 关键顺序不变量：专用规则必须先于通用 googleapis 规则命中。
    assert.ok(
      rules.indexOf(`DOMAIN-KEYWORD,cloudcode-pa,${AGY_DEDICATED_GROUP_NAME}`) <
        rules.indexOf(GENERIC_GOOGLEAPIS_RULE)
    )
    assert.ok(
      rules.indexOf(`DOMAIN-SUFFIX,generativelanguage.googleapis.com,${AGY_DEDICATED_GROUP_NAME}`) <
        rules.indexOf('DOMAIN,generativelanguage.googleapis.com,🤖 AI')
    )
  })

  it('falls back to 自动选择 when the agy group is absent (safe degrade)', () => {
    const profile = {
      'proxy-groups': [AUTO_GROUP],
      rules: [GENERIC_GOOGLEAPIS_RULE]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = rulesOf(profile)
    assert.equal(rules[0], `DOMAIN-KEYWORD,cloudcode-pa,${AUTO_SELECT_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN-SUFFIX,aicode.googleapis.com,${AUTO_SELECT_GROUP_NAME}`))
  })

  it('skips injection when neither group exists', () => {
    const profile = {
      'proxy-groups': [{ name: '🔍 Google', type: 'select' }],
      rules: [GENERIC_GOOGLEAPIS_RULE]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    assert.deepEqual(profile.rules, [GENERIC_GOOGLEAPIS_RULE])
  })

  it('rewrites rules left over from the previous 自动选择 target instead of duplicating them', () => {
    const profile = {
      'proxy-groups': [AGY_GROUP, AUTO_GROUP],
      rules: [
        `DOMAIN-KEYWORD,cloudcode-pa,${AUTO_SELECT_GROUP_NAME}`,
        `DOMAIN-SUFFIX,aicode.googleapis.com,${AUTO_SELECT_GROUP_NAME}`,
        `DOMAIN-SUFFIX,generativelanguage.googleapis.com,${AUTO_SELECT_GROUP_NAME}`,
        GENERIC_GOOGLEAPIS_RULE
      ]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = rulesOf(profile)
    assert.equal(rules.length, 4)
    assert.equal(rules.filter((rule) => rule.endsWith(`,${AUTO_SELECT_GROUP_NAME}`)).length, 0)
    assert.equal(rules[0], `DOMAIN-KEYWORD,cloudcode-pa,${AGY_DEDICATED_GROUP_NAME}`)
    assert.equal(rules[3], GENERIC_GOOGLEAPIS_RULE)
  })

  it('is idempotent when the rules are already present', () => {
    const profile = {
      'proxy-groups': [AGY_GROUP, AUTO_GROUP],
      rules: [
        `DOMAIN-KEYWORD,cloudcode-pa,${AGY_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,aicode.googleapis.com,${AGY_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,generativelanguage.googleapis.com,${AGY_DEDICATED_GROUP_NAME}`,
        GENERIC_GOOGLEAPIS_RULE
      ]
    } as unknown as MihomoConfig

    injectAntigravityTrafficRules(profile)

    const rules = rulesOf(profile)
    assert.equal(rules.length, 4)
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN-KEYWORD,cloudcode-pa,${AGY_DEDICATED_GROUP_NAME}`)
        .length,
      1
    )
    assert.equal(rules[3], GENERIC_GOOGLEAPIS_RULE)
  })
})
