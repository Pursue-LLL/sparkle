import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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

  it('warms only Sparkle regional url-test groups', async () => {
    const delayed: string[] = []
    const result = await warmupRegionalUrlTestGroupsCore({
      mihomoGroups: async () => [
        {
          name: 'Sparkle-自动-新加坡',
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
      ],
      mihomoGroupDelay: async (group) => {
        delayed.push(group)
        return {}
      }
    })

    assert.equal(result.warmed, 1)
    assert.equal(result.failures.length, 0)
    assert.deepEqual(delayed, ['Sparkle-自动-新加坡'])
  })
})
