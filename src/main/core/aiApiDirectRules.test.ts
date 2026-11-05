import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AI_API_DIRECT_HOSTS, ensureAiApiDirectRules } from './aiApiDirectRules'

function rulesOf(profile: MihomoConfig): string[] {
  return (profile.rules as string[]) ?? []
}

/** 期望值由清单生成，新增域名无需再改测试。 */
const DEFAULT_RULES = AI_API_DIRECT_HOSTS.map((host) => `DOMAIN-SUFFIX,${host},DIRECT`)
const MATCH_RULE = 'MATCH,🐟 漏网之鱼'

/** 除某个域名外的默认规则，用于「该域名已被接管」的场景。 */
function defaultsExcept(host: string): string[] {
  return AI_API_DIRECT_HOSTS.filter((item) => item !== host).map(
    (item) => `DOMAIN-SUFFIX,${item},DIRECT`
  )
}

describe('aiApiDirectRules', () => {
  it('prepends every default DIRECT rule ahead of the subscription catch-alls', () => {
    const profile = {
      rules: ['GEOIP,CN,🎯 全球直连', MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [...DEFAULT_RULES, 'GEOIP,CN,🎯 全球直连', MATCH_RULE])
  })

  it('lets an override win for each host, whichever domain-rule type it uses', () => {
    for (const host of AI_API_DIRECT_HOSTS) {
      const overrides = [
        `DOMAIN-SUFFIX,${host},🚀 节点选择`,
        `DOMAIN,${host},🎯 agy 专用`,
        `DOMAIN-SUFFIX,.${host},🚀 节点选择`,
        `DOMAIN-KEYWORD,${host.split('.')[0]},🎯 agy 专用`
      ]

      for (const overrideRule of overrides) {
        const profile = { rules: [overrideRule, MATCH_RULE] } as unknown as MihomoConfig

        ensureAiApiDirectRules(profile)

        assert.deepEqual(rulesOf(profile), [...defaultsExcept(host), overrideRule, MATCH_RULE])
      }
    }
  })

  it('also yields when a narrower subdomain rule already exists', () => {
    const narrowRule = 'DOMAIN,api.opencode.ai,🎯 agy 专用'
    const profile = { rules: [narrowRule, MATCH_RULE] } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), [
      ...defaultsExcept('opencode.ai'),
      narrowRule,
      MATCH_RULE
    ])
  })

  it('ignores unrelated rules and stays idempotent', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,example.com,🚀 节点选择', MATCH_RULE]
    } as unknown as MihomoConfig

    ensureAiApiDirectRules(profile)
    const once = [...rulesOf(profile)]
    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), once)
    assert.deepEqual(once, [...DEFAULT_RULES, 'DOMAIN-SUFFIX,example.com,🚀 节点选择', MATCH_RULE])
  })

  it('survives a profile without rules', () => {
    const profile = {} as MihomoConfig

    ensureAiApiDirectRules(profile)

    assert.deepEqual(rulesOf(profile), DEFAULT_RULES)
  })
})
