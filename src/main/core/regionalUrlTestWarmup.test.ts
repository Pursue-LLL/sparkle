import assert from 'node:assert/strict'
import { before, beforeEach, describe, it, mock } from 'node:test'
import type * as Warmup from './regionalUrlTestWarmup'

type Api = Parameters<typeof Warmup.warmupRegionalUrlTestGroups>[0]

const logs: string[] = []
const delayed: string[] = []
let failing = new Map<string, unknown>()

function urlTestGroup(name: string): Record<string, unknown> {
  return { name, type: 'URLTest', testUrl: 'https://probe.example/gen_204' }
}

const api = {
  mihomoGroups: async () => [
    urlTestGroup('Sparkle-台湾'),
    urlTestGroup('Sparkle-日本'),
    urlTestGroup('Sparkle-新加坡')
  ],
  mihomoGroupDelay: async (group: string): Promise<void> => {
    delayed.push(group)
    if (failing.has(group)) {
      throw failing.get(group)
    }
  }
} as unknown as Api

describe('warmupRegionalUrlTestGroups', () => {
  let warmup: typeof Warmup

  before(() => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    warmup = require('./regionalUrlTestWarmup') as typeof Warmup
  })

  beforeEach(() => {
    logs.length = 0
    delayed.length = 0
    failing = new Map()
  })

  it('warms the active groups and logs how many', async () => {
    const warmed = await warmup.warmupRegionalUrlTestGroups(
      api,
      new Set(['Sparkle-台湾', 'Sparkle-日本'])
    )

    assert.equal(warmed, 2)
    assert.deepEqual(delayed, ['Sparkle-台湾', 'Sparkle-日本'])
    assert.deepEqual(logs, ['[RegionalUrlTestWarmup]: warmed 2 regional url-test groups\n'])
  })

  it('logs each group that failed to warm, then the count of those that did', async () => {
    failing = new Map<string, unknown>([
      ['Sparkle-日本', new Error('timeout')],
      ['Sparkle-新加坡', 'refused']
    ])

    const warmed = await warmup.warmupRegionalUrlTestGroups(
      api,
      new Set(['Sparkle-台湾', 'Sparkle-日本', 'Sparkle-新加坡'])
    )

    assert.equal(warmed, 1)
    assert.deepEqual(logs, [
      '[RegionalUrlTestWarmup]: Sparkle-日本 failed, timeout\n',
      '[RegionalUrlTestWarmup]: Sparkle-新加坡 failed, refused\n',
      '[RegionalUrlTestWarmup]: warmed 1 regional url-test groups\n'
    ])
  })

  it('says nothing about warming when no group could be warmed', async () => {
    failing = new Map([['Sparkle-台湾', new Error('timeout')]])

    assert.equal(await warmup.warmupRegionalUrlTestGroups(api, new Set(['Sparkle-台湾'])), 0)

    assert.deepEqual(logs, ['[RegionalUrlTestWarmup]: Sparkle-台湾 failed, timeout\n'])
  })

  it('does nothing and logs nothing when no group is active', async () => {
    assert.equal(await warmup.warmupRegionalUrlTestGroups(api, new Set()), 0)

    assert.deepEqual(delayed, [])
    assert.deepEqual(logs, [])
  })
})
