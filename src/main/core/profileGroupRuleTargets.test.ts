import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { rewriteMissingRuleProxyGroupTargets } from './profileGroupNormalize'

describe('rewriteMissingRuleProxyGroupTargets', () => {
  it('rewrites stale hop group rules to Cursor dedicated when Cursor group exists', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['SDK DNS'] },
        { name: 'SDK DNS', type: 'select', proxies: ['自动选择'] }
      ],
      rules: ['GEOIP,us,🚀 节点选择', 'DOMAIN-KEYWORD,chatgpt,🚀 节点选择']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, [
      `GEOIP,us,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,chatgpt,${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })

  it('rewrites unknown group rules to subscription main select when Cursor group is absent', () => {
    const profile = {
      'proxy-groups': [{ name: 'SDK DNS', type: 'select', proxies: ['自动选择'] }],
      rules: ['GEOIP,us,🚀 节点选择', 'DOMAIN-SUFFIX,example.com,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['GEOIP,us,SDK DNS', 'DOMAIN-SUFFIX,example.com,SDK DNS'])
  })

  it('picks the first subscription select group as the main one, skipping Sparkle and non-select groups', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: '备用', type: 'fallback' },
        { name: '主代理', type: 'select' },
        { name: '次代理', type: 'select' }
      ],
      rules: ['DOMAIN,example.com,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['DOMAIN,example.com,主代理'])
  })

  it('treats a group without a type as a select group', () => {
    const profile = {
      'proxy-groups': [{ name: '主代理' }],
      rules: ['DOMAIN,example.com,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['DOMAIN,example.com,主代理'])
  })

  it('keeps the no-resolve modifier when it rewrites the target', () => {
    const profile = {
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: ['IP-CIDR,1.2.3.4/32,不存在组,no-resolve', 'GEOIP,cn,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['IP-CIDR,1.2.3.4/32,主代理,no-resolve', 'GEOIP,cn,主代理'])
  })

  it('leaves comments, blanks, built-in targets, known groups and incomplete rules alone', () => {
    const rules = [
      '',
      '# DOMAIN,example.com,不存在组',
      'DOMAIN,example.com,DIRECT',
      'DOMAIN,example.com,REJECT',
      'DOMAIN,example.com,主代理',
      'DOMAIN,example.com,',
      'DOMAIN,不存在组'
    ]
    const profile = {
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: [...rules]
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('still sends stale template hop rules to the Cursor group when there is no select group', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: '备用', type: 'fallback' }
      ],
      rules: ['DOMAIN,cursor.sh,🚀 节点选择', 'DOMAIN,example.com,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, [
      `DOMAIN,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      'DOMAIN,example.com,不存在组'
    ])
  })

  it('repairs a catch-all MATCH that points at a missing group', () => {
    const profile = {
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: ['DOMAIN,example.com,DIRECT', 'MATCH,不存在组']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['DOMAIN,example.com,DIRECT', 'MATCH,主代理'])
  })

  it('never sends the catch-all into the Cursor group, not even for a stale template hop', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: '主代理', type: 'select' }
      ],
      rules: ['DOMAIN,cursor.sh,🚀 节点选择', 'MATCH,🚀 节点选择']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, [
      `DOMAIN,cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      'MATCH,主代理'
    ])
  })

  it('keeps a MATCH that already points at a built-in target, a known group or an inline node', () => {
    for (const target of ['DIRECT', '主代理', 'SG-01']) {
      const profile = {
        proxies: [{ name: 'SG-01', type: 'ss' }],
        'proxy-groups': [{ name: '主代理', type: 'select' }],
        rules: [`MATCH,${target}`]
      } as unknown as MihomoConfig

      rewriteMissingRuleProxyGroupTargets(profile)

      assert.deepEqual(profile.rules, [`MATCH,${target}`])
    }
  })

  it('keeps rules that point straight at an inline node, the only nodes mihomo accepts as targets', () => {
    const profile = {
      proxies: [{ name: 'SG-01', type: 'ss' }, null, { type: 'ss' }],
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: ['DOMAIN,a.com,SG-01', 'IP-CIDR,1.2.3.4/32,SG-01,no-resolve', 'DOMAIN,b.com,SG-02']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, [
      'DOMAIN,a.com,SG-01',
      'IP-CIDR,1.2.3.4/32,SG-01,no-resolve',
      'DOMAIN,b.com,主代理'
    ])
  })

  it('treats a profile whose proxies are not a list as having no inline nodes', () => {
    const profile = {
      proxies: { 'SG-01': {} },
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: ['DOMAIN,a.com,SG-01']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['DOMAIN,a.com,主代理'])
  })

  it('does not mistake a rule made only of modifiers for one with a target', () => {
    const rules = ['no-resolve', 'no-resolve,no-resolve,no-resolve']
    const profile = {
      'proxy-groups': [{ name: '主代理', type: 'select' }],
      rules: [...rules]
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('has nothing to point a rule at when the subscription has no select group', () => {
    const rules = ['DOMAIN,example.com,不存在组']
    const profile = {
      'proxy-groups': [{ name: '备用', type: 'fallback' }],
      rules: [...rules]
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, rules)
  })

  it('tolerates a profile without groups or without rules', () => {
    const noGroups = { rules: ['DOMAIN,example.com,不存在组'] } as unknown as MihomoConfig
    const noRules = {
      'proxy-groups': [{ name: '主代理', type: 'select' }]
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(noGroups)
    rewriteMissingRuleProxyGroupTargets(noRules)

    assert.deepEqual(noGroups.rules, ['DOMAIN,example.com,不存在组'])
    assert.equal(noRules.rules, undefined)
  })

  it('keeps rules when target group already exists in subscription', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['HK-1'] },
        { name: '主代理', type: 'select', proxies: ['🚀 节点选择'] }
      ],
      rules: ['GEOIP,us,🚀 节点选择']
    } as unknown as MihomoConfig

    rewriteMissingRuleProxyGroupTargets(profile)

    assert.deepEqual(profile.rules, ['GEOIP,us,🚀 节点选择'])
  })
})
