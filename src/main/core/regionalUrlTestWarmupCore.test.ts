import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTO_SELECT_DELAY_TEST_URL,
  CURSOR_AUTO_SELECT_GROUP_NAME,
  CURSOR_DELAY_TEST_URL,
  GEMINI_REACHABILITY_PROBE_URL,
} from './cursorProxyGroup'
import {
  assertRegionalUrlTestWarmupApi,
  collectActiveWarmupGroupNames,
  warmupRegionalUrlTestGroupsCore
} from './regionalUrlTestWarmupCore'

describe('regionalUrlTestWarmupCore', () => {
  it('requires injected mihomo API', () => {
    assert.throws(
      () =>
        assertRegionalUrlTestWarmupApi({
          mihomoGroups: undefined as unknown as () => Promise<ControllerMixedGroup[]>,
          mihomoGroupDelay: async () => ({})
        }),
      /requires injected mihomoGroups/
    )
  })

  it('warms Sparkle auto-select sub-groups with group-specific probe urls', async () => {
    const delayed: Array<{ group: string; url: string }> = []
    const result = await warmupRegionalUrlTestGroupsCore({
      mihomoGroups: async () => [
        {
          name: 'Sparkle-新加坡',
          type: 'URLTest',
          all: [],
          now: '',
          history: [],
          alive: true
        },
        {
          name: 'Sparkle-日本',
          type: 'URLTest',
          all: [],
          now: '',
          history: [],
          alive: true,
          testUrl: GEMINI_REACHABILITY_PROBE_URL
        },
        {
          name: CURSOR_AUTO_SELECT_GROUP_NAME,
          type: 'URLTest',
          all: [],
          now: '',
          history: [],
          alive: true
        },
        {
          name: '自动选择',
          type: 'URLTest',
          all: [],
          now: '',
          history: [],
          alive: true
        }
      ] as unknown as ControllerMixedGroup[],
      mihomoGroupDelay: async (group, url) => {
        delayed.push({ group, url: url ?? '' })
        return {}
      }
    }, new Set(['Sparkle-新加坡', 'Sparkle-日本', CURSOR_AUTO_SELECT_GROUP_NAME]))

    assert.equal(result.warmed, 3)
    assert.equal(result.failures.length, 0)
    assert.deepEqual(delayed, [
      { group: 'Sparkle-新加坡', url: AUTO_SELECT_DELAY_TEST_URL },
      { group: 'Sparkle-日本', url: GEMINI_REACHABILITY_PROBE_URL },
      { group: CURSOR_AUTO_SELECT_GROUP_NAME, url: CURSOR_DELAY_TEST_URL },
    ])
  })

  it('skips inactive regional groups and does nothing when no group is in use', async () => {
    const delayed: string[] = []
    const api = {
      mihomoGroups: async () => [
        {
          name: 'Sparkle-台湾',
          type: 'URLTest',
          all: [],
          now: '',
          history: [],
          alive: true
        }
      ] as unknown as ControllerMixedGroup[],
      mihomoGroupDelay: async (group) => {
        delayed.push(group)
        return {}
      }
    }

    const skipped = await warmupRegionalUrlTestGroupsCore(api, new Set(['Sparkle-日本']))
    assert.equal(skipped.warmed, 0)
    assert.deepEqual(delayed, [])

    const none = await warmupRegionalUrlTestGroupsCore(api, new Set())
    assert.equal(none.warmed, 0)
    assert.deepEqual(delayed, [])
  })

  it('collects only regional groups from active connection chains or current selections', () => {
    const groups = [
      { name: '🚀 节点选择', now: 'Sparkle-台湾' },
      { name: '🎯 Cursor 专用', now: 'DIRECT' },
      { name: '自动选择', now: '日本-优化' }
    ] as unknown as ControllerMixedGroup[]
    const connections = {
      downloadTotal: 0,
      uploadTotal: 0,
      memory: 0,
      connections: [
        {
          id: '1',
          metadata: {} as ControllerConnectionDetail['metadata'],
          upload: 0,
          download: 0,
          start: '',
          chains: ['🚀 节点选择', 'Sparkle-日本', '日本-优化'],
          rule: '',
          rulePayload: '',
          isActive: true
        }
      ]
    } as ControllerConnections

    assert.deepEqual(
      [...collectActiveWarmupGroupNames(groups, connections)].sort(),
      ['Sparkle-台湾', 'Sparkle-日本'].sort()
    )
    assert.deepEqual([...collectActiveWarmupGroupNames(groups, undefined)], ['Sparkle-台湾'])
  })
})
