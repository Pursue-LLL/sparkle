import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_GENERAL_DELAY_TEST_URL } from './cursorProxyGroup'
import { ensureSelectGroupsDefaultToAutoSwitch } from './defaultAutoSwitchProxy'
import { groupNamed, groupsOf, profileOf } from './defaultAutoSwitchProxyRig'

describe('defaultAutoSwitchProxy · 组的生成与引用', () => {
  it('puts the new 自动选择 where the subscription had it, regional groups right before it', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['SG-01'] },
      { name: '自动选择', type: 'url-test', proxies: ['SG-01'] },
      { name: '兜底', type: 'select', proxies: ['SG-01'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01']
    })

    assert.deepEqual(
      groupsOf(profile).map((group) => group.name),
      ['主代理', 'Sparkle-日本', 'Sparkle-新加坡', '自动选择', '兜底']
    )
  })

  it('puts 自动选择 first when the subscription only had 故障转移', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['SG-01'] },
      { name: '故障转移', type: 'fallback', proxies: ['SG-01'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile, 'p', { leafProxyNames: ['SG-01', 'JP-01'] })

    assert.deepEqual(
      groupsOf(profile).map((group) => group.name),
      ['Sparkle-日本', 'Sparkle-新加坡', '自动选择', '主代理', '故障转移']
    )
    assert.deepEqual(groupNamed(profile, '主代理')?.proxies, [
      'SG-01',
      '自动选择',
      'Sparkle-日本',
      'Sparkle-新加坡',
      '故障转移'
    ])
  })

  it('replaces Sparkle groups of an earlier generation but leaves the Hong Kong group alone', () => {
    const hongKong = { name: 'Sparkle-香港', type: 'url-test', use: ['p'] }
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['JP-01'] },
      { name: 'Sparkle-日本', type: 'select', proxies: ['旧节点'] },
      { name: 'Sparkle-火星', type: 'url-test', proxies: ['旧节点'] },
      { name: 'Sparkle-自动-Cursor', type: 'url-test', proxies: ['旧节点'] },
      hongKong,
      { name: '自动选择', type: 'fallback', proxies: ['旧节点'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, { leafProxyNames: ['JP-01'] })

    assert.deepEqual(
      groupsOf(profile).map((group) => group.name),
      ['主代理', 'Sparkle-香港', 'Sparkle-日本', '自动选择']
    )
    assert.equal(groupNamed(profile, 'Sparkle-香港'), hongKong)
    assert.equal(groupNamed(profile, 'Sparkle-日本')?.type, 'url-test')
    assert.deepEqual(groupNamed(profile, 'Sparkle-日本')?.proxies, ['JP-01'])
    assert.deepEqual(groupNamed(profile, '自动选择')?.proxies, ['JP-01'])
  })

  it('falls back to a plain url-test 自动选择 while no node can be ranked', () => {
    const profile = profileOf([{ name: '主代理', type: 'select', proxies: ['DIRECT'] }])

    ensureSelectGroupsDefaultToAutoSwitch(profile)

    assert.deepEqual(groupsOf(profile)[0], {
      name: '自动选择',
      type: 'url-test',
      url: DEFAULT_GENERAL_DELAY_TEST_URL,
      interval: 300,
      tolerance: 2000,
      lazy: true
    })
    assert.deepEqual(groupNamed(profile, '主代理')?.proxies, ['DIRECT', '自动选择'])
  })

  it('keeps the subscription 自动选择 as it is while no node can be ranked', () => {
    const subscriptionGroup = { name: '自动选择', type: 'url-test', url: 'https://example.com/204' }
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['DIRECT'] },
      subscriptionGroup
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile)

    assert.deepEqual(
      groupsOf(profile).map((group) => group.name),
      ['主代理', '自动选择']
    )
    assert.equal(groupNamed(profile, '自动选择'), subscriptionGroup)
  })

  it('does not rank nodes that are all AnyTLS', () => {
    const profile = profileOf([{ name: '主代理', type: 'select', proxies: ['DIRECT'] }])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['SG-01', 'JP-01'],
      leafProxyCatalog: [{ name: 'SG-01', type: 'anytls' }]
    })

    assert.equal(groupNamed(profile, '自动选择')?.type, 'url-test')
    assert.equal(groupNamed(profile, 'Sparkle-日本'), undefined)
  })

  it('ranks the members of the subscription 自动选择 when no node list is passed', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['DIRECT'] },
      { name: '自动选择', type: 'url-test', proxies: ['US-01', 'JP-01', 'TW-01'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile)

    assert.deepEqual(groupNamed(profile, '自动选择')?.proxies, ['TW-01', 'JP-01', 'US-01'])
    assert.deepEqual(groupNamed(profile, 'Sparkle-日本')?.proxies, ['JP-01'])
  })

  it('lists 自动选择 once when a group named both the legacy and the new group', () => {
    const profile = profileOf([
      { name: '🔰 手动选择', type: 'select', proxies: ['♻️ 自动选择', 'DIRECT', '自动选择'] },
      { name: '♻️ 自动选择', type: 'url-test', proxies: ['JP-01'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, { leafProxyNames: ['JP-01'] })

    assert.deepEqual(groupNamed(profile, '🔰 手动选择')?.proxies, [
      '自动选择',
      'DIRECT',
      'Sparkle-日本'
    ])
  })

  it('does not repeat the auto-switch groups a select group already offers', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['JP-01', 'Sparkle-日本', '自动选择'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['JP-01', 'SG-01']
    })

    assert.deepEqual(groupNamed(profile, '主代理')?.proxies, [
      'JP-01',
      'Sparkle-日本',
      '自动选择',
      'Sparkle-新加坡'
    ])
  })

  it('never points a group at an 自动选择 that does not exist', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['DIRECT'] },
      { name: '故障转移', type: 'fallback', proxies: ['DIRECT'] }
    ])

    ensureSelectGroupsDefaultToAutoSwitch(profile)

    assert.equal(groupNamed(profile, '自动选择'), undefined)
    assert.deepEqual(groupNamed(profile, '主代理')?.proxies, ['DIRECT', '故障转移'])
  })

  it('does nothing for a profile without proxy groups', () => {
    const noGroups = { rules: ['MATCH,DIRECT'] } as unknown as MihomoConfig
    const emptyGroups = profileOf([])

    const results = [noGroups, emptyGroups].map((profile) =>
      ensureSelectGroupsDefaultToAutoSwitch(profile)
    )

    for (const result of results) {
      assert.deepEqual(result, {
        groupsMutated: 0,
        proxiesRemoved: 0,
        removedLeaves: [],
        groupsRemoved: []
      })
    }
    assert.equal(noGroups['proxy-groups'], undefined)
    assert.deepEqual(emptyGroups['proxy-groups'], [])
  })

  it('still ranks nodes outside the preferred regions when no regional group can be built', () => {
    const profile = profileOf([{ name: '主代理', type: 'select', proxies: ['DIRECT'] }])

    ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['德国 01', '德国 02']
    })

    assert.deepEqual(
      groupsOf(profile).map((group) => group.name),
      ['自动选择', '主代理']
    )
    assert.equal(groupNamed(profile, '自动选择')?.type, 'fallback')
    assert.deepEqual(groupNamed(profile, '自动选择')?.proxies, ['德国 01', '德国 02'])
  })

  it('reports the AnyTLS nodes it took out of auto-switch groups', () => {
    const profile = profileOf([
      { name: '主代理', type: 'select', proxies: ['DIRECT'] },
      { name: 'Sparkle-香港', type: 'url-test', proxies: ['HK-A', 'HK-B'] }
    ])

    const result = ensureSelectGroupsDefaultToAutoSwitch(profile, undefined, {
      leafProxyNames: ['HK-A', 'HK-B', 'JP-01'],
      leafProxyCatalog: [
        { name: 'HK-A', type: 'anytls' },
        { name: 'HK-B', type: 'trojan' },
        { name: 'JP-01', type: 'trojan' }
      ]
    })

    assert.deepEqual(result, {
      groupsMutated: 1,
      proxiesRemoved: 1,
      removedLeaves: ['HK-A'],
      groupsRemoved: []
    })
    assert.deepEqual(groupNamed(profile, 'Sparkle-香港')?.proxies, ['HK-B'])
  })
})
