import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureAiApiDirectRules } from './aiApiDirectRules'

function rulesOf(profile: MihomoConfig): string[] {
  return (profile.rules as string[]) ?? []
}

const COMMANDCODE_RULE = 'DOMAIN-SUFFIX,api.commandcode.ai,DIRECT'
const OPENCODE_RULE = 'DOMAIN-SUFFIX,opencode.ai,DIRECT'
const MATCH_RULE = 'MATCH,🐟 漏网之鱼'

describe('aiApiDirectRules', () => {
  it('prepends DIRECT rules ahead of the subscription catch-alls', () => {
    const profile = {
      rules: ['GEOIP,CN,🎯 全球直连', MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    const rules = rulesOf(profile)
    assert.deepEqual(rules, [COMMANDCODE_RULE, OPENCODE_RULE, 'GEOIP,CN,🎯 全球直连', MATCH_RULE])
    // 关键顺序不变量：直连规则必须先于 MATCH 命中。
    assert.ok(rules.indexOf(OPENCODE_RULE) < rules.indexOf(MATCH_RULE))
  })

  it('leaves an override rule untouched and adds no duplicate', () => {
    const overrideRule = 'DOMAIN-SUFFIX,opencode.ai,🚀 节点选择'
    const profile = {
      rules: [overrideRule, MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    const rules = rulesOf(profile)
    assert.deepEqual(rules, [COMMANDCODE_RULE, overrideRule, MATCH_RULE])
    assert.equal(rules.filter((rule) => rule.includes('opencode.ai')).length, 1)
  })

  it('fills only the domain that has no rule yet', () => {
    const overrideRule = 'DOMAIN-SUFFIX,api.commandcode.ai,🎯 agy 专用'
    const profile = {
      rules: [overrideRule, MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [OPENCODE_RULE, overrideRule, MATCH_RULE])
  })

  it('keeps unrelated rules and is idempotent', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,example.com,🚀 节点选择', MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)
    const once = [...rulesOf(profile)]
    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), once)
    assert.deepEqual(once, [
      COMMANDCODE_RULE,
      OPENCODE_RULE,
      'DOMAIN-SUFFIX,example.com,🚀 节点选择',
      MATCH_RULE
    ])
  })

  it('survives a profile without rules', () => {
    const profile = {} as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [COMMANDCODE_RULE, OPENCODE_RULE])
  })
})
