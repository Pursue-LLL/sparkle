import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME, ensureCustomProxyGroups } from './customProxyGroups'
import { groupNames, groupProxies, profileOf, subscriptionGroupNames } from './customProxyGroupsRig'

describe('customProxyGroups · 香港组', () => {
  it('matches Hong Kong nodes with HK keyword variants', () => {
    const profile = {
      'proxy-groups': [{ name: '默认', type: 'select', proxies: [] }]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, [
      '香港 01',
      'HK-Node',
      'Hong Kong Premium',
      'hongkong-lite',
      'SG-01'
    ])

    const hkGroup = (
      (profile['proxy-groups'] as { name: string; type?: string; proxies?: string[] }[]) ?? []
    ).find((group) => group.name === HONG_KONG_FILTER_GROUP_NAME)
    assert.equal(hkGroup?.type, 'select')
    assert.deepEqual(hkGroup?.proxies, ['香港 01', 'HK-Node', 'Hong Kong Premium', 'hongkong-lite'])
  })

  it('builds Hong Kong provider group as url-test (auto lowest, manual pin supported)', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['HK-01', 'SG-01'], 'test-profile')

    const hkGroup = (profile['proxy-groups'] as { name: string }[]).find(
      (group) => group.name === HONG_KONG_FILTER_GROUP_NAME
    )
    // HK 组按规则路由 x.com/Stripe，探针 = x.com（它实际承载的流量）。
    assert.deepEqual(hkGroup, {
      name: HONG_KONG_FILTER_GROUP_NAME,
      type: 'url-test',
      url: 'https://x.com',
      interval: 300,
      timeout: 5000,
      lazy: true,
      use: ['test-profile'],
      filter: '香港|(?i)\\bHK\\b|hong\\s*kong|hongkong'
    })
  })

  it('drops a group named 香港专用 whatever members it has, and moves its rules', () => {
    const profile = profileOf(
      [{ name: '香港专用', type: 'select', proxies: ['HK-01', 'SG-01'] }],
      ['DOMAIN,x.com,香港专用']
    )

    ensureCustomProxyGroups(profile, ['HK-01', 'SG-01'], 'test-profile')

    assert.deepEqual(subscriptionGroupNames(profile), [])
    assert.deepEqual(profile.rules, [`DOMAIN,x.com,${HONG_KONG_FILTER_GROUP_NAME}`])
  })

  it('drops redundant 香港专用 wrapper and rewrites rules to 🇭🇰 香港节点', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] },
        {
          name: '香港专用',
          type: 'select',
          proxies: ['🚀 节点选择', HONG_KONG_FILTER_GROUP_NAME]
        }
      ],
      rules: [
        'DOMAIN-KEYWORD,stripe,香港专用',
        'DOMAIN-SUFFIX,stripe.com,香港专用',
        `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['KR-VPS-HY2', 'HK-1'], 'test-profile')

    assert.ok(!groupNames(profile).includes('香港专用'))
    assert.deepEqual(profile.rules, [
      `DOMAIN-KEYWORD,stripe,${HONG_KONG_FILTER_GROUP_NAME}`,
      `DOMAIN-SUFFIX,stripe.com,${HONG_KONG_FILTER_GROUP_NAME}`,
      `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`
    ])
    assert.ok(!groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME).includes('香港专用'))
  })

  it('drops a group that only routes to Hong Kong and is named after it, whatever the name', () => {
    const profile = profileOf(
      [
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] },
        { name: 'HK 出口', type: 'select', proxies: ['GLOBAL', HONG_KONG_FILTER_GROUP_NAME] },
        { name: '港区专用', type: 'select', proxies: ['🚀 节点选择', HONG_KONG_FILTER_GROUP_NAME] }
      ],
      ['DOMAIN,a.com,HK 出口', 'DOMAIN,b.com,港区专用', 'DOMAIN,c.com,🚀 节点选择']
    )

    ensureCustomProxyGroups(profile, ['HK-01'], 'test-profile')

    assert.deepEqual(subscriptionGroupNames(profile), ['🚀 节点选择'])
    assert.deepEqual(profile.rules, [
      `DOMAIN,a.com,${HONG_KONG_FILTER_GROUP_NAME}`,
      `DOMAIN,b.com,${HONG_KONG_FILTER_GROUP_NAME}`,
      'DOMAIN,c.com,🚀 节点选择'
    ])
  })

  it('keeps groups that only look like a Hong Kong wrapper', () => {
    const profile = profileOf([
      { name: '香港备用', type: 'select', proxies: ['SG-01', HONG_KONG_FILTER_GROUP_NAME] },
      { name: '套餐', type: 'select', proxies: [HONG_KONG_FILTER_GROUP_NAME] },
      { name: '香港节点池', type: 'select', proxies: [] },
      { name: '香港空组', type: 'select' }
    ])

    ensureCustomProxyGroups(profile, ['HK-01'], 'test-profile')

    assert.deepEqual(subscriptionGroupNames(profile), [
      '香港备用',
      '套餐',
      '香港节点池',
      '香港空组'
    ])
  })

  it('keeps 香港专用 while there is no Hong Kong group to take its place', () => {
    const rules = ['DOMAIN,stripe.com,香港专用']
    const profile = profileOf(
      [{ name: '香港专用', type: 'select', proxies: ['🚀 节点选择'] }],
      [...rules]
    )

    ensureCustomProxyGroups(profile, ['SG-01'])

    assert.deepEqual(subscriptionGroupNames(profile), ['香港专用'])
    assert.deepEqual(profile.rules, rules)
  })

  it('keeps no-resolve, and moves the catch-all too, when rules leave a dropped wrapper group', () => {
    const profile = profileOf(
      [{ name: '香港专用', type: 'select', proxies: [HONG_KONG_FILTER_GROUP_NAME] }],
      ['IP-CIDR,1.2.3.4/32,香港专用,no-resolve', 'DOMAIN-KEYWORD,香港专用,套餐', 'MATCH,香港专用']
    )

    ensureCustomProxyGroups(profile, ['HK-01'], 'test-profile')

    assert.deepEqual(profile.rules, [
      `IP-CIDR,1.2.3.4/32,${HONG_KONG_FILTER_GROUP_NAME},no-resolve`,
      'DOMAIN-KEYWORD,香港专用,套餐',
      `MATCH,${HONG_KONG_FILTER_GROUP_NAME}`
    ])
  })
})
