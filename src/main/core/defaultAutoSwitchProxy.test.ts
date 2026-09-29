import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_DIRECT_PROXY, CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  appendRegionalAutoGroupsToCursorDedicated,
  applyDefaultAutoSwitchSelections,
  ensureSelectGroupsDefaultToAutoSwitch,
  isGroupOnAutoSwitch,
  resolvePreferredAutoSwitchProxy,
  shouldApplyDefaultAutoSwitch
} from './defaultAutoSwitchProxy'

describe('defaultAutoSwitchProxy', () => {
  it('injects 自动选择 manual-select over the fast provider', () => {
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
      use?: string[]
      filter?: string
      proxies?: string[]
    }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    // 自动选择 = native fallback chain over priority regions + 其他地区 兜底.
    assert.equal(autoSelect?.type, 'fallback')
    // 自动选择 = fallback，成员来自 sparkle-fast（按地区优先级排序的扁平文件）。
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
    assert.equal(autoSelect?.proxies, undefined)
    assert.equal(
      groups.find((group) => group.name === 'Sparkle-新加坡')?.type,
      'url-test'
    )
    const sgGroup = groups.find((group) => group.name === 'Sparkle-新加坡')
    assert.deepEqual(sgGroup?.use, ['test-profile'])
    assert.equal(sgGroup?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgGroup?.proxies, undefined)
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      '自动选择',
      'Sparkle-台湾',
      'Sparkle-日本',
      'Sparkle-韩国',
      'Sparkle-新加坡',
      'Sparkle-美国'
    ])
  })

  it('keeps the 5 regional groups as manual select while 自动选择 lists fast nodes', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; url?: string; type?: string; tolerance?: number; use?: string[]; filter?: string; proxies?: string[] }[]
    const regionalGroups = groups.filter((group) => group.name.startsWith('Sparkle-'))
    assert.equal(regionalGroups.length, 5)
    for (const group of regionalGroups) {
      // 地区组 = url-test：组内自动选最低延迟；当前节点失效才切换。
      assert.equal(group.type, 'url-test')
      assert.equal(group.url, 'https://www.gstatic.com/generate_204')
      assert.equal(group.tolerance, 2000)
    }

    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
  })

  it('rewrites subscription 自动选择 into manual select over the fast provider', () => {
    const profile = {
      'proxy-groups': [
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'JP-01', 'TW-01'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['自动选择', 'SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; type?: string; proxies?: string[]; use?: string[] }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    // No provider id → fallback over the regional groups (priority order).
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.proxies, [
      'Sparkle-台湾',
      'Sparkle-日本',
      'Sparkle-韩国',
      'Sparkle-新加坡',
      'Sparkle-美国'
    ])
    assert.deepEqual(
      groups.find((group) => group.name === 'Sparkle-新加坡')?.proxies,
      ['SG-01']
    )
    assert.deepEqual(
      groups.find((group) => group.name === 'Sparkle-日本')?.proxies,
      ['JP-01']
    )
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

  it('builds regional select groups from typed catalog excluding anytls while select groups keep all', () => {
    const catalog = [
      { name: '🇸🇬 新加坡 01', type: 'anytls' },
      { name: '🇸🇬 新加坡 02', type: 'hysteria2' },
      { name: '🇯🇵 日本 01', type: 'anytls' },
      { name: '🇯🇵 日本 02', type: 'hysteria2' },
    ]
    const profile = {
      'proxy-groups': [
        {
          name: '🤖 AI',
          type: 'select',
          proxies: ['🇸🇬 新加坡 01', '🇸🇬 新加坡 02', '自动选择'],
        },
      ],
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: catalog.map((entry) => entry.name),
      leafProxyCatalog: catalog,
    })

    const groups = profile['proxy-groups'] as {
      name: string
      type?: string
      proxies?: string[]
      use?: string[]
      filter?: string
    }[]
    const sgAuto = groups.find((group) => group.name === 'Sparkle-新加坡')
    assert.deepEqual(sgAuto?.use, ['test-profile'])
    // Regional groups are url-test → AnyTLS exclusion (auto-select only) applies again.
    assert.equal(sgAuto?.filter, '(?!^(🇸🇬 新加坡 01)$)(?:新加坡|(?i)\\bSG\\b|singapore)')
    assert.equal(sgAuto?.proxies, undefined)
    const aiGroup = groups.find((group) => group.name === '🤖 AI')
    assert.equal(aiGroup?.proxies?.includes('🇸🇬 新加坡 01'), true)
    assert.equal(aiGroup?.proxies?.includes('🇸🇬 新加坡 02'), true)
  })

  it('appendRegionalAutoGroupsToCursorDedicated is idempotent for DIRECT', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: [CURSOR_DEDICATED_DIRECT_PROXY, 'KR-VPS-HY2', 'KR-VPS-TLS'],
        },
      ],
    } as unknown as MihomoConfig

    appendRegionalAutoGroupsToCursorDedicated(profile, [])
    appendRegionalAutoGroupsToCursorDedicated(profile, [])

    const cursorGroup = (profile['proxy-groups'] as { proxies?: string[] }[])[0]
    assert.deepEqual(cursorGroup?.proxies, [CURSOR_DEDICATED_DIRECT_PROXY, 'KR-VPS-HY2'])
  })

  it('prepends DIRECT to Cursor dedicated provider-mode group', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', use: ['test-profile-vps'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] },
      ],
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01', 'KR-VPS-HY2'],
    })

    const cursorGroup = (profile['proxy-groups'] as { name: string; type?: string; proxies?: string[]; use?: string[] }[]).find(
      (group) => group.name === CURSOR_DEDICATED_GROUP_NAME,
    )
    assert.deepEqual(cursorGroup?.proxies, [CURSOR_DEDICATED_DIRECT_PROXY, '自动选择'])
    assert.deepEqual(cursorGroup?.use, ['test-profile-vps'])
  })

  it('appends 自动选择 to 🎯 Cursor 专用 (no regional sub-groups)', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: [CURSOR_DEDICATED_DIRECT_PROXY],
          use: ['test-profile-vps'],
          filter: '(?i)-VPS-(HY2|Reality|TUIC)$',
        },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] },
      ],
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01', 'KR-VPS-HY2'],
    })

    const groups = profile['proxy-groups'] as { name: string; type?: string; proxies?: string[]; use?: string[] }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
    assert.equal(cursorGroup?.proxies?.at(-1), '自动选择')
    assert.equal(cursorGroup?.proxies?.includes('Sparkle-新加坡'), false)
  })

  it('appends 自动选择 to non-Cursor select groups and keeps Cursor DIRECT + VPS-only', () => {
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
    assert.equal(cursorGroup?.proxies?.includes('Sparkle-新加坡'), false)
    assert.deepEqual(cursorGroup?.proxies, [CURSOR_DEDICATED_DIRECT_PROXY, 'KR-VPS-HY2', '自动选择'])
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      'TW-01',
      '自动选择',
      'Sparkle-台湾',
      'Sparkle-日本',
      'Sparkle-韩国',
      'Sparkle-新加坡',
      'Sparkle-美国',
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

  it('applyDefaultAutoSwitchSelections is disabled and does not mutate groups', async () => {
    assert.equal(await applyDefaultAutoSwitchSelections(), 0)
  })

  it('prefers 自动选择 over 故障转移 when both are present', () => {
    const group = {
      name: '主代理',
      type: 'Selector' as const,
      now: 'SG-01',
      all: [
        { name: 'SG-01' },
        { name: '故障转移', type: 'Fallback' as const },
        { name: '自动选择', type: 'URLTest' as const }
      ]
    } as unknown as ControllerMixedGroup

    assert.equal(resolvePreferredAutoSwitchProxy(group), '自动选择')
  })

  it('skips Cursor dedicated group for runtime default auto switch', () => {
    const group = {
      name: CURSOR_DEDICATED_GROUP_NAME,
      type: 'Selector' as const,
      now: 'KR-VPS-HY2',
      all: [{ name: 'KR-VPS-HY2' }, { name: '自动选择', type: 'URLTest' as const }]
    } as unknown as ControllerMixedGroup

    assert.equal(shouldApplyDefaultAutoSwitch(group), false)
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
    assert.equal(groups.some((group) => group.name === '♻️ 自动选择'), false)

    const manual = groups.find((group) => group.name === '🔰 手动选择')
    assert.equal(manual?.proxies?.[0], '自动选择')
    assert.equal(manual?.proxies?.includes('♻️ 自动选择'), false)
    assert.equal(manual?.proxies?.includes('Sparkle-新加坡'), true)

    const rules = profile.rules as string[]
    assert.equal(rules.every((rule) => !rule.includes('♻️ 自动选择')), true)
    assert.equal(rules.some((rule) => rule.includes('自动选择')), true)
  })

  it('detects nested auto-switch selections', () => {
    const groups = [
      {
        name: '主代理',
        type: 'Selector' as const,
        now: '自动选择',
        all: [{ name: '自动选择', type: 'URLTest' as const }]
      },
      {
        name: '自动选择',
        type: 'URLTest' as const,
        now: 'SG-01',
        all: [{ name: 'SG-01' }]
      }
    ] as unknown as ControllerMixedGroup[]

    assert.equal(isGroupOnAutoSwitch(groups[0], groups), true)
  })
})
