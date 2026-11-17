import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  injectQuicTrafficRules,
  QUIC_REJECT_RULE,
  STUN_CLOUDFLARE_REJECT_RULE
} from './quicTrafficRuleInjection'

describe('quicTrafficRuleInjection', () => {
  it('prepends QUIC and STUN protection rules to the top of rules', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,google.com,🔍 Google', 'MATCH,🐟 漏网之鱼']
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], QUIC_REJECT_RULE)
    assert.equal(rules[1], STUN_CLOUDFLARE_REJECT_RULE)
    assert.equal(rules[2], 'DOMAIN-SUFFIX,google.com,🔍 Google')
    assert.equal(rules[3], 'MATCH,🐟 漏网之鱼')
  })

  it('initializes rules array if undefined', () => {
    const profile = {} as MihomoConfig

    injectQuicTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules.length, 2)
    assert.equal(rules[0], QUIC_REJECT_RULE)
    assert.equal(rules[1], STUN_CLOUDFLARE_REJECT_RULE)
  })

  it('is idempotent and does not duplicate existing rules', () => {
    const profile = {
      rules: [QUIC_REJECT_RULE, STUN_CLOUDFLARE_REJECT_RULE, 'MATCH,DIRECT']
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules.length, 3)
    assert.equal(rules.filter((rule) => rule === QUIC_REJECT_RULE).length, 1)
    assert.equal(rules.filter((rule) => rule === STUN_CLOUDFLARE_REJECT_RULE).length, 1)
  })

  it('moves copies buried mid-chain (an override ran before the built-in rules) to the top', () => {
    const profile = {
      rules: [
        'DOMAIN-KEYWORD,cloudcode-pa,🎯 agy 专用',
        'IP-CIDR,203.0.113.7/32,DIRECT,no-resolve',
        'DOMAIN-SUFFIX,stripe.com,Sparkle-香港',
        QUIC_REJECT_RULE,
        STUN_CLOUDFLARE_REJECT_RULE,
        'MATCH,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    assert.deepEqual(profile.rules, [
      QUIC_REJECT_RULE,
      STUN_CLOUDFLARE_REJECT_RULE,
      'DOMAIN-KEYWORD,cloudcode-pa,🎯 agy 专用',
      'IP-CIDR,203.0.113.7/32,DIRECT,no-resolve',
      'DOMAIN-SUFFIX,stripe.com,Sparkle-香港',
      'MATCH,DIRECT'
    ])
  })

  it('keeps one copy of each rule when the chain carries several, whatever their padding', () => {
    const profile = {
      rules: [
        `  ${STUN_CLOUDFLARE_REJECT_RULE}`,
        'DOMAIN-SUFFIX,example.com,DIRECT',
        `${QUIC_REJECT_RULE}  `,
        QUIC_REJECT_RULE,
        STUN_CLOUDFLARE_REJECT_RULE
      ]
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    assert.deepEqual(profile.rules, [
      QUIC_REJECT_RULE,
      STUN_CLOUDFLARE_REJECT_RULE,
      'DOMAIN-SUFFIX,example.com,DIRECT'
    ])
  })

  it('leaves rules that merely resemble the protection rules alone', () => {
    const lookalikes = [
      'AND,((DST-PORT,443),(NETWORK,UDP)),DIRECT',
      'AND,((DST-PORT,443),(NETWORK,TCP)),REJECT',
      'DOMAIN-SUFFIX,stun.cloudflare.com,DIRECT'
    ]
    const profile = { rules: [...lookalikes] } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    assert.deepEqual(profile.rules, [QUIC_REJECT_RULE, STUN_CLOUDFLARE_REJECT_RULE, ...lookalikes])
  })

  it('produces the same chain when applied again', () => {
    const profile = {
      rules: ['DOMAIN-SUFFIX,example.com,DIRECT', QUIC_REJECT_RULE, 'MATCH,DIRECT']
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)
    const once = [...(profile.rules as string[])]
    injectQuicTrafficRules(profile)

    assert.deepEqual(profile.rules, once)
  })
})
