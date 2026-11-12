import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CURSOR_DEDICATED_DIRECT_PROXY, CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  appendRegionalAutoGroupsToCursorDedicated,
  ensureSelectGroupsDefaultToAutoSwitch
} from './defaultAutoSwitchProxy'
import {
  groupNamed,
  profileOf,
  REGIONAL_GROUPS_WITHOUT_HONG_KONG
} from './defaultAutoSwitchProxyRig'

describe('defaultAutoSwitchProxy · Cursor 专用组', () => {
  it('appendRegionalAutoGroupsToCursorDedicated is idempotent for DIRECT', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: [CURSOR_DEDICATED_DIRECT_PROXY, 'KR-VPS-HY2', 'KR-VPS-TLS']
        }
      ]
    } as unknown as MihomoConfig

    appendRegionalAutoGroupsToCursorDedicated(profile)
    appendRegionalAutoGroupsToCursorDedicated(profile)

    const cursorGroup = (profile['proxy-groups'] as { proxies?: string[] }[])[0]
    assert.deepEqual(cursorGroup?.proxies, [CURSOR_DEDICATED_DIRECT_PROXY, 'KR-VPS-HY2'])
  })

  it('appendRegionalAutoGroupsToCursorDedicated adds regional groups before 自动选择, never Hong Kong', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: [CURSOR_DEDICATED_DIRECT_PROXY]
        },
        { name: 'Sparkle-香港', type: 'url-test', use: ['p'] },
        { name: 'Sparkle-台湾', type: 'url-test', use: ['p'] },
        { name: 'Sparkle-日本', type: 'url-test', use: ['p'] },
        { name: '自动选择', type: 'fallback', use: ['sparkle-fast'] }
      ]
    } as unknown as MihomoConfig

    appendRegionalAutoGroupsToCursorDedicated(profile)
    appendRegionalAutoGroupsToCursorDedicated(profile)

    const cursorGroup = (profile['proxy-groups'] as { proxies?: string[] }[])[0]
    assert.deepEqual(cursorGroup?.proxies, [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'Sparkle-台湾',
      'Sparkle-日本',
      '自动选择'
    ])
  })

  it('prepends DIRECT to Cursor dedicated provider-mode group', () => {
    const profile = {
      'proxy-groups': [
        { name: CURSOR_DEDICATED_GROUP_NAME, type: 'select', use: ['test-profile-vps'] },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01', 'KR-VPS-HY2']
    })

    const cursorGroup = (
      profile['proxy-groups'] as {
        name: string
        type?: string
        proxies?: string[]
        use?: string[]
      }[]
    ).find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.deepEqual(cursorGroup?.proxies, [
      CURSOR_DEDICATED_DIRECT_PROXY,
      ...REGIONAL_GROUPS_WITHOUT_HONG_KONG,
      '自动选择'
    ])
    assert.deepEqual(cursorGroup?.use, ['test-profile-vps'])
  })

  it('adds the five regional groups (no Hong Kong) and 自动选择 to 🎯 Cursor 专用', () => {
    const profile = {
      'proxy-groups': [
        {
          name: CURSOR_DEDICATED_GROUP_NAME,
          type: 'select',
          proxies: [CURSOR_DEDICATED_DIRECT_PROXY],
          use: ['test-profile-vps'],
          filter: '(?i)-VPS-(HY2|Reality|TUIC)$'
        },
        { name: '🚀 节点选择', type: 'select', proxies: ['SG-01'] }
      ]
    } as unknown as MihomoConfig

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'test-profile', {
      leafProxyNames: ['SG-01', 'JP-01', 'TW-01', 'KR-01', 'US-01', 'KR-VPS-HY2']
    })

    const groups = profile['proxy-groups'] as {
      name: string
      type?: string
      proxies?: string[]
      use?: string[]
    }[]
    const autoSelect = groups.find((group) => group.name === '自动选择')
    const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
    assert.equal(autoSelect?.type, 'fallback')
    assert.deepEqual(autoSelect?.use, ['sparkle-fast'])
    assert.equal(cursorGroup?.proxies?.at(-1), '自动选择')
    assert.deepEqual(cursorGroup?.proxies?.slice(1, -1), REGIONAL_GROUPS_WITHOUT_HONG_KONG)
    assert.equal(
      cursorGroup?.proxies?.some((name) => name.includes('香港')),
      false
    )
  })

  it('keeps the members of a provider-backed Cursor group and stays stable on repeat', () => {
    const profile = profileOf([
      {
        name: CURSOR_DEDICATED_GROUP_NAME,
        type: 'select',
        use: ['p-vps'],
        proxies: [CURSOR_DEDICATED_DIRECT_PROXY, '手选节点']
      },
      { name: 'Sparkle-台湾', type: 'url-test', use: ['p'] },
      { name: '自动选择', type: 'fallback', use: ['sparkle-fast'] }
    ])

    appendRegionalAutoGroupsToCursorDedicated(profile)
    appendRegionalAutoGroupsToCursorDedicated(profile)

    assert.deepEqual(groupNamed(profile, CURSOR_DEDICATED_GROUP_NAME)?.proxies, [
      CURSOR_DEDICATED_DIRECT_PROXY,
      '手选节点',
      'Sparkle-台湾',
      '自动选择'
    ])
  })

  it('does not reference an 自动选择 that is not there', () => {
    const profile = profileOf([
      {
        name: CURSOR_DEDICATED_GROUP_NAME,
        type: 'select',
        proxies: [CURSOR_DEDICATED_DIRECT_PROXY]
      },
      { name: 'Sparkle-台湾', type: 'url-test', use: ['p'] }
    ])

    appendRegionalAutoGroupsToCursorDedicated(profile)

    assert.deepEqual(groupNamed(profile, CURSOR_DEDICATED_GROUP_NAME)?.proxies, [
      CURSOR_DEDICATED_DIRECT_PROXY,
      'Sparkle-台湾'
    ])
  })

  it('leaves a profile without the Cursor group, or without groups, alone', () => {
    const profile = profileOf([{ name: 'Sparkle-台湾', type: 'url-test', use: ['p'] }])
    const before = structuredClone(profile)

    appendRegionalAutoGroupsToCursorDedicated(profile)
    appendRegionalAutoGroupsToCursorDedicated({} as MihomoConfig)

    assert.deepEqual(profile, before)
  })
})
