import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME, GROK_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'
import {
  collectSubscriptionGroupNames,
  dropUnknownGroupMembers,
  ensureMatchFallbackRule,
  removeNonSubscriptionProxyGroups,
  rewriteMissingRuleProxyGroupTargets
} from './profileGroupNormalize'

function groupNames(profile: MihomoConfig): string[] {
  return ((profile['proxy-groups'] as { name: string }[] | undefined) ?? []).map(
    (group) => group.name
  )
}

describe('profileGroupNormalize', () => {
  it('collectSubscriptionGroupNames excludes Sparkle injected and 香港专用 wrapper', () => {
    const names = collectSubscriptionGroupNames({
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: HONG_KONG_FILTER_GROUP_NAME, type: 'select' },
        { name: GROK_DEDICATED_GROUP_NAME, type: 'url-test' },
        { name: '香港专用', type: 'select' },
        { name: 'SDK DNS', type: 'select' }
      ]
    } as unknown as MihomoConfig)

    assert.deepEqual([...names], ['SDK DNS'])
  })

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

  it('removes phantom groups not owned by current subscription', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: HONG_KONG_FILTER_GROUP_NAME, type: 'select' },
        { name: 'SDK DNS', type: 'select' },
        { name: '🚀 节点选择', type: 'select', proxies: [CURSOR_DEDICATED_GROUP_NAME] },
        { name: '🌍 国外媒体', type: 'select', proxies: [CURSOR_DEDICATED_GROUP_NAME] }
      ]
    } as unknown as MihomoConfig

    removeNonSubscriptionProxyGroups(profile, new Set(['SDK DNS', '自动选择', '故障转移']))

    assert.deepEqual(groupNames(profile), [
      CURSOR_DEDICATED_GROUP_NAME,
      HONG_KONG_FILTER_GROUP_NAME,
      'SDK DNS'
    ])
  })

  it('preserves subscription-native hop groups after switching back to matching profile', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select' },
        { name: '🚀 节点选择', type: 'select', proxies: ['HK-1'] },
        { name: '主代理', type: 'select', proxies: ['🚀 节点选择'] }
      ]
    } as unknown as MihomoConfig

    removeNonSubscriptionProxyGroups(
      profile,
      new Set(['🚀 节点选择', '主代理', '自动选择', '负载均衡'])
    )

    assert.ok(groupNames(profile).includes('🚀 节点选择'))
    assert.ok(groupNames(profile).includes('主代理'))
  })

  it('drops unknown group members so mihomo can load the whole profile', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['JP-01'] },
        {
          name: '🍃 应用净化',
          type: 'select',
          proxies: ['REJECT', 'DIRECT', '🚀 节点选择', '🇭🇰 香港 I0B | AWS']
        },
        { name: '空组', type: 'select', proxies: ['已下架节点'] }
      ]
    } as unknown as MihomoConfig

    const dropped = dropUnknownGroupMembers(profile, ['JP-01'])

    assert.deepEqual(profile['proxy-groups'], [
      { name: '🚀 节点选择', type: 'select', proxies: ['JP-01'] },
      {
        name: '🍃 应用净化',
        type: 'select',
        proxies: ['REJECT', 'DIRECT', '🚀 节点选择']
      },
      { name: '空组', type: 'select', proxies: ['DIRECT'] }
    ])
    assert.deepEqual(dropped, [
      { group: '🍃 应用净化', dropped: ['🇭🇰 香港 I0B | AWS'] },
      { group: '空组', dropped: ['已下架节点'] }
    ])
  })

  it('appends a MATCH fallback when the profile has none', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['JP-01'] },
        { name: '自动选择', type: 'fallback', proxies: ['JP-01'] }
      ],
      rules: ['DOMAIN-SUFFIX,example.com,🚀 节点选择']
    } as unknown as MihomoConfig

    assert.equal(ensureMatchFallbackRule(profile), '🚀 节点选择')
    assert.deepEqual(profile.rules, [
      'DOMAIN-SUFFIX,example.com,🚀 节点选择',
      'MATCH,🚀 节点选择'
    ])
  })

  it('keeps an existing MATCH and falls back to 自动选择 when the main group is absent', () => {
    const existing = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select' }],
      rules: ['MATCH,DIRECT']
    } as unknown as MihomoConfig
    assert.equal(ensureMatchFallbackRule(existing), null)
    assert.deepEqual(existing.rules, ['MATCH,DIRECT'])

    const fallback = {
      'proxy-groups': [{ name: '自动选择', type: 'fallback' }],
      rules: []
    } as unknown as MihomoConfig
    assert.equal(ensureMatchFallbackRule(fallback), '自动选择')
    assert.deepEqual(fallback.rules, ['MATCH,自动选择'])

    const direct = {
      'proxy-groups': [{ name: '其它', type: 'select' }],
      rules: []
    } as unknown as MihomoConfig
    assert.equal(ensureMatchFallbackRule(direct), 'DIRECT')
    assert.deepEqual(direct.rules, ['MATCH,DIRECT'])
  })
})
