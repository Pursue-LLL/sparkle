import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensureAiApiDirectRules } from './aiApiDirectRules'

function rulesOf(profile: MihomoConfig): string[] {
  return (profile.rules as string[]) ?? []
}

const COMMANDCODE_RULE = 'DOMAIN-SUFFIX,api.commandcode.ai,DIRECT'
const OPENCODE_RULE = 'DOMAIN-SUFFIX,opencode.ai,DIRECT'

describe('aiApiDirectRules', () => {
  it('prepends DIRECT rules ahead of the subscription catch-alls', () => {
    const profile = {
      rules: ['GEOIP,CN,🎯 全球直连', 'MATCH,🐟 漏网之鱼']
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    const rules = rulesOf(profile)
    assert.deepEqual(rules.slice(0, 2), [COMMANDCODE_RULE, OPENCODE_RULE])
    assert.equal(rules.at(-2), 'GEOIP,CN,🎯 全球直连')
    assert.equal(rules.at(-1), 'MATCH,🐟 漏网之鱼')
    // 关键顺序不变量：直连规则必须先于 MATCH 命中。
    assert.ok(rules.indexOf(OPENCODE_RULE) < rules.indexOf('MATCH,🐟 漏网之鱼'))
  })

  it('retargets a subscription rule that already routes the domain into a proxy group', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,opencode.ai,🐟 漏网之鱼', 'MATCH,🐟 漏网之鱼']
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    const rules = rulesOf(profile)
    assert.equal(rules[0], COMMANDCODE_RULE)
    assert.equal(rules[1], OPENCODE_RULE)
    assert.equal(rules.filter((rule) => rule.startsWith('DOMAIN-SUFFIX,opencode.ai')).length, 1)
  })

  it('keeps unrelated rules and is idempotent', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,example.com,🚀 节点选择', 'MATCH,🐟 漏网之鱼']
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)
    const once = [...rulesOf(profile)]
    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), once)
    assert.deepEqual(once, [
      COMMANDCODE_RULE,
      OPENCODE_RULE,
      'DOMAIN-SUFFIX,example.com,🚀 节点选择',
      'MATCH,🐟 漏网之鱼'
    ])
  })

  it('survives a profile without rules', () => {
    const profile = {} as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [COMMANDCODE_RULE, OPENCODE_RULE])
  })
})
