import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAutoSwitchGroup,
  planAutoSwitchPinRelease,
  type AutoSwitchGroupSnapshot
} from './autoSwitchPinReleaseCore'

describe('isAutoSwitchGroup', () => {
  it('identifies URLTest and url-test as auto switch groups', () => {
    assert.equal(isAutoSwitchGroup({ name: 'Sparkle-台湾', type: 'URLTest' }), true)
    assert.equal(isAutoSwitchGroup({ name: 'Sparkle-香港', type: 'url-test' }), true)
    assert.equal(isAutoSwitchGroup({ name: 'Auto - Speed', type: 'URLTest' }), true)
  })

  it('identifies 自动选择 as an auto switch group', () => {
    assert.equal(isAutoSwitchGroup({ name: '自动选择', type: 'Fallback' }), true)
  })

  it('excludes Selector groups', () => {
    assert.equal(isAutoSwitchGroup({ name: '🚀 节点选择', type: 'Selector' }), false)
    assert.equal(isAutoSwitchGroup({ name: '🎯 Cursor 专用', type: 'select' }), false)
  })
})

describe('planAutoSwitchPinRelease', () => {
  const groups: AutoSwitchGroupSnapshot[] = [
    {
      name: 'Sparkle-台湾',
      type: 'URLTest',
      fixed: '台湾-优化2-GPT',
      all: ['台湾-优化', '台湾-优化2-GPT', '🇹🇼 台湾 02']
    },
    {
      name: 'Sparkle-香港',
      type: 'URLTest',
      fixed: '🇭🇰 香港 I2 (已删除)',
      all: ['🇭🇰 香港 01', '🇭🇰 香港 02']
    },
    { name: 'Sparkle-日本', type: 'URLTest', fixed: '', all: ['🇯🇵 日本 01', '🇯🇵 日本 02'] },
    { name: 'Sparkle-韩国', type: 'URLTest', all: ['🇰🇷 韩国 01'] },
    { name: '🚀 节点选择', type: 'Selector', fixed: '自动选择', all: ['自动选择', 'Sparkle-台湾'] }
  ]

  it('scope all releases every pin on auto switch groups and leaves selectors alone', () => {
    assert.deepEqual(planAutoSwitchPinRelease(groups, 'all'), [
      { group: 'Sparkle-台湾', pinnedNode: '台湾-优化2-GPT', reason: 'cache-restored' },
      { group: 'Sparkle-香港', pinnedNode: '🇭🇰 香港 I2 (已删除)', reason: 'orphan' }
    ])
  })

  it('scope orphans releases only pins whose node left the group', () => {
    assert.deepEqual(planAutoSwitchPinRelease(groups, 'orphans'), [
      { group: 'Sparkle-香港', pinnedNode: '🇭🇰 香港 I2 (已删除)', reason: 'orphan' }
    ])
  })

  it('treats a fixed 自动选择 pin like any other auto switch group pin', () => {
    const pinned: AutoSwitchGroupSnapshot[] = [
      { name: '自动选择', type: 'Fallback', fixed: '台湾-优化3', all: ['台湾-优化3', '🇹🇼 台湾 02'] }
    ]

    assert.equal(planAutoSwitchPinRelease(pinned, 'all').length, 1)
    assert.equal(planAutoSwitchPinRelease(pinned, 'orphans').length, 0)
  })

  it('returns nothing when no group is pinned', () => {
    assert.deepEqual(planAutoSwitchPinRelease([groups[2], groups[3]], 'all'), [])
  })
})
