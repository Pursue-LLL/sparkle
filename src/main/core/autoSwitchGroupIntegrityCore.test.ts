import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectDeadlockAutoSwitchGroups,
  isAutoSwitchGroup,
  reconcileStartupAutoSwitchGroups,
  type AutoSwitchGroupSnapshot
} from './autoSwitchGroupIntegrityCore'

describe('autoSwitchGroupIntegrityCore - isAutoSwitchGroup', () => {
  it('identifies URLTest and url-test as auto switch groups', () => {
    assert.equal(isAutoSwitchGroup({ name: 'Sparkle-台湾', type: 'URLTest' }), true)
    assert.equal(isAutoSwitchGroup({ name: 'Sparkle-香港', type: 'url-test' }), true)
    assert.equal(isAutoSwitchGroup({ name: 'Auto - Speed', type: 'URLTest' }), true)
  })

  it('excludes 自动选择 (delegated to autoSelectStickyPin)', () => {
    assert.equal(isAutoSwitchGroup({ name: '自动选择', type: 'Fallback' }), false)
    assert.equal(isAutoSwitchGroup({ name: '自动选择', type: 'URLTest' }), false)
  })

  it('excludes Selector groups', () => {
    assert.equal(isAutoSwitchGroup({ name: '🚀 节点选择', type: 'Selector' }), false)
    assert.equal(isAutoSwitchGroup({ name: '🎯 Cursor 专用', type: 'select' }), false)
  })
})

describe('autoSwitchGroupIntegrityCore - reconcileStartupAutoSwitchGroups', () => {
  const sampleGroups: AutoSwitchGroupSnapshot[] = [
    {
      name: 'Sparkle-台湾',
      type: 'URLTest',
      now: '台湾-优化2-GPT',
      fixed: '台湾-优化2-GPT',
      all: ['台湾-优化', '台湾-优化2-GPT', '🇹🇼 台湾 02']
    },
    {
      name: 'Sparkle-香港',
      type: 'URLTest',
      now: '🇭🇰 香港 01',
      fixed: '🇭🇰 香港 I2 (已删除)',
      all: ['🇭🇰 香港 01', '🇭🇰 香港 02']
    },
    {
      name: 'Sparkle-日本',
      type: 'URLTest',
      now: '🇯🇵 日本 02',
      fixed: '',
      all: ['🇯🇵 日本 01', '🇯🇵 日本 02']
    },
    {
      name: '🚀 节点选择',
      type: 'Selector',
      now: '自动选择',
      fixed: '自动选择',
      all: ['自动选择', 'Sparkle-台湾']
    }
  ]

  it('clears cache.db fixed locks on startup by default', () => {
    const actions = reconcileStartupAutoSwitchGroups(sampleGroups)
    assert.equal(actions.length, 2)
    assert.deepEqual(actions[0], {
      kind: 'unfix',
      group: 'Sparkle-台湾',
      fixedNode: '台湾-优化2-GPT',
      reason: 'startup-default-unfix'
    })
    assert.deepEqual(actions[1], {
      kind: 'unfix',
      group: 'Sparkle-香港',
      fixedNode: '🇭🇰 香港 I2 (已删除)',
      reason: 'orphan-pin'
    })
  })

  it('preserves user explicit pin unless it is an orphan pin', () => {
    const pinned = new Set(['Sparkle-台湾', 'Sparkle-香港'])
    const actions = reconcileStartupAutoSwitchGroups(sampleGroups, pinned)
    // 台湾组因为在用户显式锁定白名单中且节点在组内，保留不解钉；
    // 香港组虽然在白名单，但节点已经不存在于当前订阅（孤儿），必须解钉
    assert.equal(actions.length, 1)
    assert.deepEqual(actions[0], {
      kind: 'unfix',
      group: 'Sparkle-香港',
      fixedNode: '🇭🇰 香港 I2 (已删除)',
      reason: 'orphan-pin'
    })
  })
})

describe('autoSwitchGroupIntegrityCore - detectDeadlockAutoSwitchGroups', () => {
  it('unfixes immediately when a fixed node is dead', () => {
    const groups: AutoSwitchGroupSnapshot[] = [
      {
        name: 'Sparkle-台湾',
        type: 'URLTest',
        now: '台湾-优化2-GPT',
        fixed: '台湾-优化2-GPT',
        all: ['台湾-优化', '台湾-优化2-GPT', '🇹🇼 台湾 02'],
        testUrl: 'https://gemini.google.com'
      }
    ]

    const aliveMap = new Map([
      ['台湾-优化', true],
      ['台湾-优化2-GPT', false],
      ['🇹🇼 台湾 02', true]
    ])

    const actions = detectDeadlockAutoSwitchGroups(groups, (node) => aliveMap.get(node) ?? false)
    assert.equal(actions.length, 1)
    assert.deepEqual(actions[0], {
      kind: 'unfix',
      group: 'Sparkle-台湾',
      fixedNode: '台湾-优化2-GPT',
      reason: 'dead-pinned-node'
    })
  })

  it('does not unfix when a fixed node is still alive', () => {
    const groups: AutoSwitchGroupSnapshot[] = [
      {
        name: 'Sparkle-台湾',
        type: 'URLTest',
        now: '🇹🇼 台湾 02',
        fixed: '🇹🇼 台湾 02',
        all: ['台湾-优化', '台湾-优化2-GPT', '🇹🇼 台湾 02']
      }
    ]

    const actions = detectDeadlockAutoSwitchGroups(groups, (node) => node === '🇹🇼 台湾 02')
    assert.equal(actions.length, 0)
  })

  it('unfixes orphan pins even if alive check is true', () => {
    const groups: AutoSwitchGroupSnapshot[] = [
      {
        name: 'Sparkle-香港',
        type: 'URLTest',
        now: '🇭🇰 香港 01',
        fixed: 'DELETED_NODE',
        all: ['🇭🇰 香港 01', '🇭🇰 香港 02']
      }
    ]

    const actions = detectDeadlockAutoSwitchGroups(groups, () => true)
    assert.equal(actions.length, 1)
    assert.deepEqual(actions[0], {
      kind: 'unfix',
      group: 'Sparkle-香港',
      fixedNode: 'DELETED_NODE',
      reason: 'orphan-pin'
    })
  })
})
