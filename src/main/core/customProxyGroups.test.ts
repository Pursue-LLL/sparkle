import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_GROUP_NAME, HONG_KONG_DELAY_TEST_URL, LEGACY_CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { HONG_KONG_FILTER_GROUP_NAME, ensureCustomProxyGroups, resolveFailoverProxyGroup } from './customProxyGroups'

function groupNames(profile: MihomoConfig): string[] {
  return ((profile['proxy-groups'] as { name: string }[] | undefined) ?? []).map(
    (group) => group.name
  )
}

function groupProxies(profile: MihomoConfig, name: string): string[] {
  const group = ((profile['proxy-groups'] as { name: string; proxies?: string[] }[]) ?? []).find(
    (item) => item.name === name
  )
  return group?.proxies ?? []
}

describe('customProxyGroups', () => {
  it('builds Cursor group from VPS leaf nodes and subscription group names', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01', 'KR-VPS-HY2', 'TW-01'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['SG-01', 'KR-VPS-HY2', 'TW-01', 'HK-01'], 'test-profile')

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [])
    const cursorGroup = ((profile['proxy-groups'] as { name: string; use?: string[]; filter?: string }[]) ?? []).find(
      (group) => group.name === CURSOR_DEDICATED_GROUP_NAME
    )
    assert.deepEqual(cursorGroup?.use, ['test-profile-vps'])
    assert.equal(cursorGroup?.filter, undefined)
    assert.ok(groupNames(profile).includes(HONG_KONG_FILTER_GROUP_NAME))
    assert.ok(groupNames(profile).includes('🚀 节点选择'))
    assert.equal(groupNames(profile)[0], CURSOR_DEDICATED_GROUP_NAME)
  })

  it('skips Cursor group when there are no VPS nodes and no subscription groups', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['SG-01', 'JP-02'], 'test-profile')

    assert.ok(!groupNames(profile).includes(CURSOR_DEDICATED_GROUP_NAME))
    assert.ok(groupNames(profile).includes(HONG_KONG_FILTER_GROUP_NAME))
  })

  it('refreshes Sparkle groups and drops stale subscription copies', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: ['stale-node']
        },
        {
          name: HONG_KONG_FILTER_GROUP_NAME,
          type: 'select',
          proxies: ['stale-hk']
        },
        { name: '套餐组', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['MY-VPS-01', '香港-A', 'SG-01'], 'test-profile')

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), [])
    const hkGroup = ((profile['proxy-groups'] as { name: string; filter?: string }[]) ?? []).find(
      (group) => group.name === HONG_KONG_FILTER_GROUP_NAME
    )
    assert.equal(hkGroup?.filter, '香港|(?i)\\bHK\\b|hong\\s*kong|hongkong')
    assert.equal(groupNames(profile).filter((name) => name === CURSOR_DEDICATED_GROUP_NAME).length, 1)
  })

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

    const hkGroup = ((profile['proxy-groups'] as { name: string; type?: string; proxies?: string[] }[]) ?? []).find(
      (group) => group.name === HONG_KONG_FILTER_GROUP_NAME
    )
    assert.equal(hkGroup?.type, 'url-test')
    assert.deepEqual(hkGroup?.proxies, [
      '香港 01',
      'HK-Node',
      'Hong Kong Premium',
      'hongkong-lite'
    ])
  })

  it('builds Hong Kong provider group as url-test for auto hop', () => {
    const profile = { 'proxy-groups': [] } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['HK-01', 'SG-01'], 'test-profile')

    const hkGroup = ((profile['proxy-groups'] as { name: string; type?: string; url?: string; filter?: string }[]) ?? []).find(
      (group) => group.name === HONG_KONG_FILTER_GROUP_NAME
    )
    assert.equal(hkGroup?.type, 'url-test')
    assert.equal(hkGroup?.url, HONG_KONG_DELAY_TEST_URL)
    assert.equal(hkGroup?.filter, '香港|(?i)\\bHK\\b|hong\\s*kong|hongkong')
  })

  it('excludes auto-hop groups from Cursor group members', () => {
    const profile = {
      'proxy-groups': [
        { name: '手动', type: 'select', proxies: ['SG-01'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] },
        { name: '故障转移', type: 'fallback', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureCustomProxyGroups(profile, ['MY-VPS-01', 'SG-01'])

    assert.deepEqual(groupProxies(profile, CURSOR_DEDICATED_GROUP_NAME), ['MY-VPS-01'])
  })

  it('resolveFailoverProxyGroup falls back to first Selector when Cursor group is absent', () => {
    const groups = [
      { name: HONG_KONG_FILTER_GROUP_NAME, type: 'Selector' as const, now: 'HK-01', all: [] },
      { name: '套餐', type: 'Selector' as const, now: 'SG-01', all: [] }
    ] as unknown as ControllerMixedGroup[]

    const target = resolveFailoverProxyGroup(groups)
    assert.equal(target?.name, '套餐')
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

  it('rewrites broad GEOIP/google rules away from Cursor 专用', () => {
    const profile = {
      'proxy-groups': [{ name: '默认', type: 'select', proxies: [] }],
      rules: [
        `GEOIP,us,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,google,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,chatgpt,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-SUFFIX,.ai,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN,api2.cursor.sh,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`,
        `DOMAIN-KEYWORD,cursor,${LEGACY_CURSOR_DEDICATED_GROUP_NAME}`
      ]
    } as unknown as MihomoConfig

    const migrated = ensureCustomProxyGroups(profile, ['KR-VPS-Reality'], 'test-profile')

    assert.equal(migrated, true)
    assert.deepEqual(profile.rules, [
      'GEOIP,us,自动选择',
      'DOMAIN-KEYWORD,google,自动选择',
      'DOMAIN-KEYWORD,chatgpt,自动选择',
      'DOMAIN-SUFFIX,.ai,自动选择',
      `DOMAIN,api2.cursor.sh,${CURSOR_DEDICATED_GROUP_NAME}`,
      `DOMAIN-KEYWORD,cursor,${CURSOR_DEDICATED_GROUP_NAME}`
    ])
  })
})
