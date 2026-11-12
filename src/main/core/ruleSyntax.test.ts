import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRule, RULE_BUILTIN_TARGETS, rewriteRulePolicies } from './ruleSyntax'

function profileWithRules(...rules: string[]): MihomoConfig {
  return { rules } as unknown as MihomoConfig
}

describe('parseRule', () => {
  it('splits the policy from type and payload', () => {
    assert.deepEqual(parseRule('DOMAIN-SUFFIX,example.com,Proxy'), {
      head: ['DOMAIN-SUFFIX', 'example.com'],
      policy: 'Proxy'
    })
  })

  it('trims the whitespace around every field', () => {
    assert.deepEqual(parseRule('  DOMAIN , example.com , 🚀 节点选择  '), {
      head: ['DOMAIN', 'example.com'],
      policy: '🚀 节点选择'
    })
  })

  it('reads the policy in front of the modifiers', () => {
    assert.deepEqual(parseRule('IP-CIDR,1.1.1.1/32,Proxy,no-resolve'), {
      head: ['IP-CIDR', '1.1.1.1/32'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('IP-CIDR,1.1.1.1/32,Proxy, no-resolve ,no-resolve'), {
      head: ['IP-CIDR', '1.1.1.1/32'],
      policy: 'Proxy'
    })
  })

  it('takes the last field of a logical rule as its policy', () => {
    assert.deepEqual(parseRule('AND,((DOMAIN,a.com),(NETWORK,UDP)),Proxy'), {
      head: ['AND', '((DOMAIN', 'a.com)', '(NETWORK', 'UDP))'],
      policy: 'Proxy'
    })
  })

  it('reads the policy of a MATCH rule, which has no payload', () => {
    assert.deepEqual(parseRule('MATCH,Proxy'), { head: ['MATCH'], policy: 'Proxy' })
    assert.deepEqual(parseRule('  match , Proxy ,no-resolve'), { head: ['match'], policy: 'Proxy' })
  })

  it('reports a trailing comma as an empty policy', () => {
    assert.deepEqual(parseRule('DOMAIN,a.com,'), { head: ['DOMAIN', 'a.com'], policy: '' })
  })

  it('ignores blank lines, comments and rules without type, payload and policy', () => {
    for (const rule of [
      '',
      '   ',
      '# DOMAIN,a.com,Proxy',
      '  # DOMAIN,a.com,Proxy',
      'MATCH',
      'MATCH,no-resolve',
      'DOMAIN,a.com',
      'DOMAIN,a.com,no-resolve',
      'no-resolve'
    ]) {
      assert.equal(parseRule(rule), undefined, rule)
    }
  })
})

describe('rewriteRulePolicies', () => {
  it('swaps the policy and keeps modifiers and the other fields as written', () => {
    const profile = profileWithRules(
      'DOMAIN,a.com,Old',
      'IP-CIDR, 1.1.1.1/32 , Old , no-resolve',
      'AND,((DOMAIN,a.com),(NETWORK,UDP)),Old',
      ' MATCH , Old ',
      'DOMAIN,b.com,Other'
    )

    rewriteRulePolicies(profile, ({ policy }) => (policy === 'Old' ? 'New' : undefined))

    assert.deepEqual(profile.rules, [
      'DOMAIN,a.com,New',
      'IP-CIDR, 1.1.1.1/32 ,New, no-resolve',
      'AND,((DOMAIN,a.com),(NETWORK,UDP)),New',
      'MATCH ,New',
      'DOMAIN,b.com,Other'
    ])
  })

  it('hands the picker the trimmed type, payload and policy', () => {
    const seen: unknown[] = []
    const profile = profileWithRules(' DOMAIN , a.com , Old ,no-resolve')

    rewriteRulePolicies(profile, (rule) => {
      seen.push(rule)
      return undefined
    })

    assert.deepEqual(seen, [{ head: ['DOMAIN', 'a.com'], policy: 'Old' }])
  })

  it('keeps a rule exactly as it was when the picker has no new policy', () => {
    const original = ['  DOMAIN , a.com , Old ', 'DOMAIN,b.com,Old']
    const profile = profileWithRules(...original)
    let call = 0

    rewriteRulePolicies(profile, () => (call++ === 0 ? undefined : ''))

    assert.deepEqual(profile.rules, original)
  })

  it('does not ask about blank, comment, incomplete or policy-less rules', () => {
    const rules = ['', '# DOMAIN,a.com,Old', 'MATCH', 'DOMAIN,a.com,', 'DOMAIN,a.com,no-resolve']
    const profile = profileWithRules(...rules)
    let asked = 0

    rewriteRulePolicies(profile, () => {
      asked += 1
      return 'New'
    })

    assert.equal(asked, 0)
    assert.deepEqual(profile.rules, rules)
  })

  it('tolerates a profile without rules', () => {
    const noRules = {} as MihomoConfig
    const emptyRules = profileWithRules()

    rewriteRulePolicies(noRules, () => 'New')
    rewriteRulePolicies(emptyRules, () => 'New')

    assert.equal(noRules.rules, undefined)
    assert.deepEqual(emptyRules.rules, [])
  })
})

describe('RULE_BUILTIN_TARGETS', () => {
  it('lists the outbounds that are not proxy groups', () => {
    assert.deepEqual([...RULE_BUILTIN_TARGETS].sort(), [
      'DIRECT',
      'DNS',
      'NOOP',
      'PASS',
      'REJECT',
      'REJECT-DROP'
    ])
  })
})
