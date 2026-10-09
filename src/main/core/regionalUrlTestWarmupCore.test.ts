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
    })

    assert.equal(result.warmed, 3)
    assert.equal(result.failures.length, 0)
    assert.deepEqual(delayed, [
      { group: 'Sparkle-新加坡', url: AUTO_SELECT_DELAY_TEST_URL },
      { group: 'Sparkle-日本', url: GEMINI_REACHABILITY_PROBE_URL },
      { group: CURSOR_AUTO_SELECT_GROUP_NAME, url: CURSOR_DELAY_TEST_URL },
    ])
  })
})
