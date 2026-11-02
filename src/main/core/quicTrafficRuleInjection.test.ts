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
      rules: [
        'DOMAIN-SUFFIX,google.com,🔍 Google',
        'MATCH,🐟 漏网之鱼'
      ]
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
      rules: [
        QUIC_REJECT_RULE,
        STUN_CLOUDFLARE_REJECT_RULE,
        'MATCH,DIRECT'
      ]
    } as unknown as MihomoConfig

    injectQuicTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules.length, 3)
    assert.equal(rules.filter((rule) => rule === QUIC_REJECT_RULE).length, 1)
    assert.equal(rules.filter((rule) => rule === STUN_CLOUDFLARE_REJECT_RULE).length, 1)
  })
})
