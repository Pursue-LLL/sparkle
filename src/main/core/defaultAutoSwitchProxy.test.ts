import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_DIRECT_PROXY, CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { ensureSelectGroupsDefaultToAutoSwitch } from './defaultAutoSwitchProxy'
import { REGIONAL_GROUPS_WITHOUT_HONG_KONG } from './defaultAutoSwitchProxyRig'

describe('defaultAutoSwitchProxy', () => {
  it('builds 自动选择 as fallback over sparkle-fast flat nodes (not regional groups)', () => {
    const profile = {
      'proxy-groups': [
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] },
        { name: 'SG 节点', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as {
      name: string
      type?: string
      tolerance?: number
      use?: string[]
      filter?: string
      proxies?: string[]
    }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.equal(autoSelect?.tolerance, undefined)
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
    assert.equal(autoSelect?.proxies, undefined)
    const sgGroup = groups.find((group) => group.name === 'Sparkle-新加坡')
    assert.equal(sgGroup?.type, 'url-test')
    assert.deepEqual(sgGroup?.use, ['test-profile'])
    assert.equal(sgGroup?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgGroup?.proxies, undefined)
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      '自动选择',
      ...REGIONAL_GROUPS_WITHOUT_HONG_KONG
    ])
  })

  it('probes 自动选择 and every regional group with Gemini, excluding AnyTLS', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as {
      name: string
      url?: string
      type?: string
      tolerance?: number
      timeout?: number
      interval?: number
      lazy?: boolean
      use?: string[]
      'exclude-type'?: string
    }[]
    const regionalGroups = groups.filter((group) => group.name.startsWith('Sparkle-'))
    assert.equal(regionalGroups.length, 5)
    for (const group of regionalGroups) {
      assert.equal(group.type, 'url-test')
      assert.equal(group.url, 'https://gemini.google.com')
      assert.equal(group.tolerance, 2000)
      assert.equal(group.timeout, 5000)
      assert.equal(group.interval, 300)
      assert.equal(group.lazy, true)
      assert.equal(group['exclude-type'], 'anytls')
    }

    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.equal(autoSelect?.url, 'https://gemini.google.com')
    assert.equal(autoSelect?.timeout, 5000)
    assert.equal(autoSelect?.interval, 300)
    assert.equal(autoSelect?.lazy, true)
    assert.equal(autoSelect?.tolerance, undefined)
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
  })

  it('rewrites subscription 自动选择 into flat fallback proxy list (TW before JP)', () => {
    const profile = {
      'proxy-groups': [
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'JP-01', 'TW-01'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['自动选择', 'SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as {
      name: string
      type?: string
      proxies?: string[]
      use?: string[]
    }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.proxies, ['TW-01', 'JP-01', 'KR-01', 'SG-01', 'US-01'])
    assert.deepEqual(groups.find((group) => group.name === 'Sparkle-新加坡')?.proxies, ['SG-01'])
    assert.deepEqual(groups.find((group) => group.name === 'Sparkle-日本')?.proxies, ['JP-01'])
  })

  it('uses provider filter for regional select groups when profileId is set', () => {
    const malaysiaNode = '🇸🇬 马来西亚 B15 | 皖日隧道、ChatGPT、Netflix(SG) | 3x'
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', malaysiaNode, 'JP-01']
    })

    const groups = profile['proxy-groups'] as {
      name: string
      proxies?: string[]
      use?: string[]
      filter?: string
    }[]
    const sgGroup = groups.find((group) => group.name === 'Sparkle-新加坡')
    assert.deepEqual(sgGroup?.use, ['test-profile'])
    assert.equal(sgGroup?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgGroup?.proxies, undefined)
  })

  it('skips regions without eligible nodes so no empty (direct-type) group joins the chain', () => {
    const catalog = [
      { name: '🇸🇬 新加坡 01', type: 'anytls' },
      { name: '🇸🇬 新加坡 02', type: 'trojan' },
      { name: '🇯🇵 日本 01', type: 'anytls' },
      { name: '🇯🇵 日本 02', type: 'anytls' }
    ]
    const profile = {
      'proxy-groups': [
        {
          name: '🤖 AI',
          type: 'select',
          proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02', '自动选择']
        }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: catalog.map((entry) => entry.name),
      leafProxyCatalog: catalog
    })

    const groups = profile['proxy-groups'] as {
      name: string
      type?: string
      proxies?: string[]
      use?: string[]
      filter?: string
      'exclude-type'?: string
    }[]
    const sgAuto = groups.find((group) => group.name === 'Sparkle-新加坡')
    assert.deepEqual(sgAuto?.use, ['test-profile'])
    assert.equal(sgAuto?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgAuto?.['exclude-type'], 'anytls')
    assert.equal(sgAuto?.proxies, undefined)
    // 日本 only has AnyTLS nodes, so it gets no group and stays out of the chain.
    assert.equal(
      groups.some((group) => group.name === 'Sparkle-日本'),
      false
    )
    assert.deepEqual(groups.find((group) => group.name === '自动选择')?.use, ['sparkle-fast'])
    assert.equal(groups.find((group) => group.name === '自动选择')?.proxies, undefined)
    const aiGroup = groups.find((group) => group.name === '🤖 AI')
    assert.equal(aiGroup?.proxies?.includes('🇸🇬 新加坡 01'), true)
    assert.equal(aiGroup?.proxies?.includes('🇸🇬 新加坡 02'), true)
  })

  it('appends 自动选择 to non-Cursor select groups and gives Cursor DIRECT + VPS + regional groups', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', proxies: ['KR-VPS-HY2'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] },
        { name: '故障转移', type: 'fallback', proxies: ['SG-01'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01', 'TW-01'] },
        { name: 'SG 节点', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; proxies?: string[]; use?: string[] }[]
    const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.deepEqual(cursorGroup?.proxies, [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'KR-VPS-HY2',
      ...REGIONAL_GROUPS_WITHOUT_HONG_KONG,
      '自动选择'
    ])
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      'TW-01',
      '自动选择',
      ...REGIONAL_GROUPS_WITHOUT_HONG_KONG,
      '故障转移'
    ])
  })

  it('keeps DIRECT as the first option on 全球直连 when appending 自动选择', () => {
    const profile = {
      'proxy-groups': [
        { name: '🎯 全球直连', type: 'select', proxies: ['DIRECT', '🚀 节点选择', 'SG-01'] },
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'TW-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'TW-01']
    })

    const directGroup = (profile['proxy-groups'] as { name: string; proxies?: string[] }[]).find(
      (group) => group.name === '🎯 全球直连'
    )
    assert.deepEqual(directGroup?.proxies, [
      'DIRECT',
      '🚀 节点选择',
      'SG-01',
      '自动选择',
      'Sparkle-台湾',
      'Sparkle-新加坡'
    ])
    assert.equal(directGroup?.proxies?.[0], 'DIRECT')
  })

  it('rewrites subscription ♻️ 自动选择 to Sparkle 自动选择 and exposes regional groups', () => {
    const profile = {
      'proxy-groups': [
        { name: '♻️ 自动选择', type: 'url-test', use: ['sub'], proxies: ['SG-01', 'JP-01'] },
        { name: '🔰 手动选择', type: 'select', proxies: ['♻️ 自动选择', 'DIRECT'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['♻️ 自动选择', 'SG-01'] }
      ],
      rules: ['DOMAIN,example.com,♻️ 自动选择', 'MATCH,♻️ 自动选择']
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; proxies?: string[]; use?: string[] }[]
    assert.equal(
      groups.some((group) => group.name === '♻️ 自动选择'),
      false
    )

    const manual = groups.find((group) => group.name === '🔰 手动选择')
    assert.equal(manual?.proxies?.[0], '自动选择')
    assert.equal(manual?.proxies?.includes('♻️ 自动选择'), false)
    assert.equal(manual?.proxies?.includes('Sparkle-新加坡'), true)

    assert.deepEqual(profile.rules, ['DOMAIN,example.com,自动选择', 'MATCH,自动选择'])
  })
})
