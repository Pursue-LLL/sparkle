import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAIL_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { injectMailTrafficRules } from './mailTrafficRuleInjection'

describe('mailTrafficRuleInjection', () => {
  it('prepends overseas mail client rules when 📧 邮件专用 group exists', () => {
    const profile = {
      'proxy-groups': [{ name: MAIL_DEDICATED_GROUP_NAME, type: 'url-test' }],
      rules: [
        'DOMAIN-SUFFIX,gmail.com,🔍 Google',
        'DOMAIN-SUFFIX,163.com,🎯 全球直连',
      ],
    } as unknown as MihomoConfig

    injectMailTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(rules[0], `DOMAIN,imap.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`)
    assert.equal(rules[1], `DOMAIN,smtp.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`)
    assert.equal(rules[2], `DOMAIN,pop.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`)
    assert.ok(rules.includes(`DOMAIN,outlook.office365.com,${MAIL_DEDICATED_GROUP_NAME}`))
    assert.ok(rules.includes(`DOMAIN,imap.mail.me.com,${MAIL_DEDICATED_GROUP_NAME}`))
    // 确保排在订阅原本的 DOMAIN-SUFFIX,gmail.com,🔍 Google 之前，且不触碰 163.com
    assert.ok(
      rules.indexOf(`DOMAIN,imap.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`) <
        rules.indexOf('DOMAIN-SUFFIX,gmail.com,🔍 Google'),
    )
    assert.equal(rules.at(-1), 'DOMAIN-SUFFIX,163.com,🎯 全球直连')
  })

  it('skips injection when 📧 邮件专用 group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select' }],
      rules: ['DOMAIN-SUFFIX,gmail.com,🔍 Google'],
    } as unknown as MihomoConfig

    injectMailTrafficRules(profile)

    assert.deepEqual(profile.rules, ['DOMAIN-SUFFIX,gmail.com,🔍 Google'])
  })

  it('is idempotent when mail rules already exist', () => {
    const profile = {
      'proxy-groups': [{ name: MAIL_DEDICATED_GROUP_NAME, type: 'url-test' }],
      rules: [`DOMAIN,imap.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`, 'MATCH,DIRECT'],
    } as unknown as MihomoConfig

    injectMailTrafficRules(profile)

    const rules = (profile.rules as string[]) ?? []
    assert.equal(
      rules.filter((rule) => rule === `DOMAIN,imap.gmail.com,${MAIL_DEDICATED_GROUP_NAME}`).length,
      1,
    )
  })
})
