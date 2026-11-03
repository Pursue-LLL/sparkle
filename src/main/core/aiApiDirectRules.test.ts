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

    assert.deepEqual(rulesOf(profile), [
      COMMANDCODE_RULE,
      OPENCODE_RULE,
      'GEOIP,CN,🎯 全球直连',
      MATCH_RULE
    ])
  })

  it('lets a DOMAIN-SUFFIX override win without adding a duplicate', () => {
    const overrideRule = 'DOMAIN-SUFFIX,opencode.ai,🚀 节点选择'
    const profile = { rules: [overrideRule, MATCH_RULE] } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [COMMANDCODE_RULE, overrideRule, MATCH_RULE])
  })

  it('treats DOMAIN and DOMAIN-KEYWORD overrides as a decision too', () => {
    for (const overrideRule of [
      'DOMAIN,opencode.ai,🎯 agy 专用',
      'DOMAIN-KEYWORD,opencode,🎯 agy 专用'
    ]) {
      const profile = { rules: [overrideRule, MATCH_RULE] } as unknown as MihomoConfig

      ensureAiApiDirectRules(profile)

      assert.deepEqual(rulesOf(profile), [COMMANDCODE_RULE, overrideRule, MATCH_RULE])
    }
  })

  it('still fills the endpoint nobody mentioned', () => {
    const overrideRule = 'DOMAIN-SUFFIX,api.commandcode.ai,🎯 agy 专用'
    const profile = { rules: [overrideRule, MATCH_RULE] } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [OPENCODE_RULE, overrideRule, MATCH_RULE])
  })

  it('ignores unrelated rules, stays idempotent, and survives a profile without rules', () => {
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

    const empty = {} as MihomoConfig
    ensureAiApiDirectRules(empty)
    assert.deepEqual(rulesOf(empty), [COMMANDCODE_RULE, OPENCODE_RULE])
  })
})
