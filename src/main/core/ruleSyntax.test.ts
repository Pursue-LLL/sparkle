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

  it('reads the field right after the payload and leaves every parameter to the kernel', () => {
    for (const rule of [
      'IP-CIDR,1.1.1.1/32,Proxy,no-resolve',
      'IP-CIDR,1.1.1.1/32,Proxy,src',
      'IP-CIDR,1.1.1.1/32,Proxy,src,no-resolve',
      'IP-CIDR,1.1.1.1/32,Proxy, no-resolve ,no-resolve',
      'IP-CIDR,1.1.1.1/32,Proxy,anything,else',
      'IP-CIDR,1.1.1.1/32,Proxy,'
    ]) {
      assert.deepEqual(parseRule(rule), { head: ['IP-CIDR', '1.1.1.1/32'], policy: 'Proxy' }, rule)
    }
  })

  it('takes the last field of the rule types whose payload contains commas', () => {
    assert.deepEqual(parseRule('AND,((DOMAIN,a.com),(NETWORK,UDP)),Proxy'), {
      head: ['AND', '((DOMAIN', 'a.com)', '(NETWORK', 'UDP))'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('or,((DOMAIN,a.com),(DOMAIN,b.com)),Proxy'), {
      head: ['or', '((DOMAIN', 'a.com)', '(DOMAIN', 'b.com))'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('NOT,((DOMAIN,a.com)),Proxy'), {
      head: ['NOT', '((DOMAIN', 'a.com))'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('DOMAIN-REGEX,^a{1,2}\\.com$,Proxy'), {
      head: ['DOMAIN-REGEX', '^a{1', '2}\\.com$'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('PROCESS-NAME-REGEX,^a{1,2}$,Proxy'), {
      head: ['PROCESS-NAME-REGEX', '^a{1', '2}$'],
      policy: 'Proxy'
    })
    assert.deepEqual(parseRule('PROCESS-PATH-REGEX,^/Applications/.{1,9}$,Proxy'), {
      head: ['PROCESS-PATH-REGEX', '^/Applications/.{1', '9}$'],
      policy: 'Proxy'
    })
  })

  it('reads the third field as the policy even when it looks like a parameter, as the kernel does', () => {
    assert.deepEqual(parseRule('DOMAIN,a.com,no-resolve'), {
      head: ['DOMAIN', 'a.com'],
      policy: 'no-resolve'
    })
  })

  it('does not treat the sub-rule a SUB-RULE rule calls as a policy', () => {
    assert.equal(parseRule('SUB-RULE,(NETWORK,tcp),subx'), undefined)
    assert.equal(parseRule('sub-rule,(AND,((NETWORK,tcp),(DST-PORT,443))),subx'), undefined)
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
      'DOMAIN,a.com',
      'AND,((DOMAIN',
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
      'IP-CIDR,1.1.1.1/32,Old,src',
      'AND,((DOMAIN,a.com),(NETWORK,UDP)),Old',
      'DOMAIN-REGEX,^a{1,2}$,Old',
      ' MATCH , Old ',
      'SUB-RULE,(NETWORK,tcp),Old',
      'DOMAIN,b.com,Other'
    )

    rewriteRulePolicies(profile, ({ policy }) => (policy === 'Old' ? 'New' : undefined))

    assert.deepEqual(profile.rules, [
      'DOMAIN,a.com,New',
      'IP-CIDR, 1.1.1.1/32 ,New, no-resolve',
      'IP-CIDR,1.1.1.1/32,New,src',
      'AND,((DOMAIN,a.com),(NETWORK,UDP)),New',
      'DOMAIN-REGEX,^a{1,2}$,New',
      'MATCH ,New',
      'SUB-RULE,(NETWORK,tcp),Old',
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
    const rules = ['', '# DOMAIN,a.com,Old', 'MATCH', 'DOMAIN,a.com,', 'SUB-RULE,(NETWORK,tcp),Old']
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
