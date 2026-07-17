import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AUTO_SELECT_DELAY_TEST_URL, CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  applyDefaultAutoSwitchSelections,
  ensureSelectGroupsDefaultToAutoSwitch,
  isGroupOnAutoSwitch,
  resolvePreferredAutoSwitchProxy,
  shouldApplyDefaultAutoSwitch
} from './defaultAutoSwitchProxy'

describe('defaultAutoSwitchProxy', () => {
  it('injects 自动选择 fallback group when subscription has none', () => {
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
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.proxies, [
      'Sparkle-自动-新加坡',
      'Sparkle-自动-日本',
      'Sparkle-自动-台湾',
      'Sparkle-自动-韩国',
      'Sparkle-自动-美国'
    ])
    assert.equal(
      groups.find((group) => group.name === 'Sparkle-自动-新加坡')?.type,
      'url-test'
    )
    const sgGroup = groups.find((group) => group.name === 'Sparkle-自动-新加坡')
    assert.deepEqual(sgGroup?.use, ['test-profile'])
    assert.equal(sgGroup?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgGroup?.proxies, undefined)
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      '自动选择'
    ])
  })

  it('uses chatgpt.com as probe URL for all regional auto-select url-test groups', () => {
    const profile = {
      'proxy-groups': [{ name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; url?: string; type?: string }[]
    const regionalGroups = groups.filter((group) => group.name.startsWith('Sparkle-自动-'))
    assert.equal(regionalGroups.length, 5)
    for (const group of regionalGroups) {
      assert.equal(group.type, 'url-test')
      assert.equal(group.url, AUTO_SELECT_DELAY_TEST_URL)
    }

    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.equal(autoSelect?.url, AUTO_SELECT_DELAY_TEST_URL)
  })

  it('rewrites subscription 自动选择 url-test into regional fallback chain', () => {
    const profile = {
      'proxy-groups': [
        { name: '自动选择', type: 'url-test', proxies: ['SG-01', 'JP-01', 'TW-01'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['自动选择', 'SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const groups = profile['proxy-groups'] as { name: string; type?: string; proxies?: string[] }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.proxies, [
      'Sparkle-自动-新加坡',
      'Sparkle-自动-日本',
      'Sparkle-自动-台湾',
      'Sparkle-自动-韩国',
      'Sparkle-自动-美国'
    ])
    assert.deepEqual(
      groups.find((group) => group.name === 'Sparkle-自动-新加坡')?.proxies,
      ['SG-01']
    )
    assert.deepEqual(
      groups.find((group) => group.name === 'Sparkle-自动-日本')?.proxies,
      ['JP-01']
    )
  })

  it('uses provider filter for regional groups when profileId is set', () => {
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
    const sgGroup = groups.find((group) => group.name === 'Sparkle-自动-新加坡')
    assert.deepEqual(sgGroup?.use, ['test-profile'])
    assert.equal(sgGroup?.filter, '新加坡|(?i)\\bSG\\b|singapore')
    assert.equal(sgGroup?.proxies, undefined)
  })

  it('prepends regional auto groups to Cursor dedicated selector', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', use: ['test-profile'], filter: '(?i)vps' },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01']
    })

    const cursorGroup = (profile['proxy-groups'] as { name: string; proxies?: string[]; use?: string[] }[]).find(
      (group) => group.name === CURSOR_DEDICATED_GROUP_NAME
    )
    assert.deepEqual(cursorGroup?.proxies, [
      'Sparkle-自动-新加坡',
      'Sparkle-自动-日本',
      'Sparkle-自动-台湾',
      'Sparkle-自动-韩国',
      'Sparkle-自动-美国'
    ])
    assert.deepEqual(cursorGroup?.use, ['test-profile'])
  })

  it('appends 自动选择 to non-Cursor select groups and keeps Cursor regional refs', () => {
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

    const groups = profile['proxy-groups'] as { name: string; proxies?: string[] }[]
    const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.ok(cursorGroup?.proxies?.includes('Sparkle-自动-新加坡'))
    assert.ok(cursorGroup?.proxies?.includes('KR-VPS-HY2'))
    assert.deepEqual(groups.find((group) => group.name === '🚀 节点选择')?.proxies, [
      'SG-01',
      'TW-01',
      '自动选择',
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
    assert.deepEqual(directGroup?.proxies, ['DIRECT', '🚀 节点选择', 'SG-01', '自动选择'])
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
