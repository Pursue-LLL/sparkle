import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME } from './customProxyGroups'
import {
  collectSubscriptionGroupNames,
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
})
