import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CODEX_DIRECT_DOMAIN_RULES,
  ensureCodexDirectRules,
  formatCodexDirectRulesLogLine,
} from './codexDirectRules'

describe('codexDirectRules', () => {
  it('prepends Codex/OpenAI DIRECT rules', () => {
    const profile = {
      rules: ['GEOIP,CN,DIRECT', 'MATCH,🚀 节点选择'],
    } as MihomoConfig
    const result = ensureCodexDirectRules(profile)
    assert.ok(result.added >= CODEX_DIRECT_DOMAIN_RULES.length)
    const rules = profile.rules as string[]
    assert.equal(rules[0], 'PROCESS-NAME,Codex,DIRECT')
    assert.ok(rules.includes('DOMAIN-SUFFIX,chatgpt.com,DIRECT'))
    assert.ok(rules.includes('DOMAIN-SUFFIX,openai.com,DIRECT'))
    assert.ok(rules.includes('GEOIP,CN,DIRECT'))
  })

  it('strips conflicting 🤖 AI targets for chatgpt/openai', () => {
    const profile = {
      rules: [
        'DOMAIN-SUFFIX,chatgpt.com,🤖 AI',
        'DOMAIN-KEYWORD,openai,🧱 GFW 列表',
        'MATCH,DIRECT',
      ],
    } as MihomoConfig
    const result = ensureCodexDirectRules(profile)
    assert.ok(result.stripped >= 2)
    const rules = profile.rules as string[]
    assert.ok(rules.includes('DOMAIN-SUFFIX,chatgpt.com,DIRECT'))
    assert.ok(!rules.includes('DOMAIN-SUFFIX,chatgpt.com,🤖 AI'))
    assert.ok(!rules.includes('DOMAIN-KEYWORD,openai,🧱 GFW 列表'))
  })

  it('is idempotent', () => {
    const profile = { rules: ['MATCH,DIRECT'] } as MihomoConfig
    ensureCodexDirectRules(profile)
    const second = ensureCodexDirectRules(profile)
    assert.equal(second.added, 0)
    assert.equal(second.stripped, 0)
    assert.match(formatCodexDirectRulesLogLine(second), /outcome=noop/)
  })
})
