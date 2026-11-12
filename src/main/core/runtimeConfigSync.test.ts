import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it, mock } from 'node:test'
import type { regenerateAndSyncProfile, syncRuntimeConfigToCore } from './runtimeConfigSync'

const logs: string[] = []
const calls: string[] = []
const providerReloads: [string, boolean][] = []
const state: {
  runtime: MihomoConfig | undefined
  liveRules: number | Error
} = { runtime: undefined, liveRules: 0 }

function runtimeWith(ruleCount: number, providers: string[] = []): MihomoConfig {
  return {
    rules: Array.from({ length: ruleCount }, (_, index) => `DOMAIN,example${index}.com,DIRECT`),
    'proxy-providers': Object.fromEntries(providers.map((name) => [name, { type: 'file' }]))
  } as unknown as MihomoConfig
}

describe('runtimeConfigSync wiring', () => {
  let sync: typeof syncRuntimeConfigToCore
  let regenerate: typeof regenerateAndSyncProfile

  before(async () => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('./autoSwitchPinRelease', {
      exports: {
        releaseAutoSwitchPins: async (scope: string): Promise<number> => {
          calls.push(`release:${scope}`)
          return 0
        }
      }
    })
    mock.module('./factory', {
      exports: {
        generateProfile: async (): Promise<void> => {
          calls.push('generate')
        },
        getRuntimeConfig: async (): Promise<MihomoConfig | undefined> => state.runtime
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        mihomoRules: async (): Promise<{ rules: unknown[] }> => {
          if (state.liveRules instanceof Error) {
            throw state.liveRules
          }
          return { rules: new Array(state.liveRules).fill({}) }
        },
        reloadMihomoConfigFromDisk: async (): Promise<void> => {
          calls.push('reload')
        }
      }
    })
    mock.module('./provider', {
      exports: {
        reloadMihomoProfileProviders: async (
          profileId: string,
          hasVpsProvider: boolean
        ): Promise<void> => {
          providerReloads.push([profileId, hasVpsProvider])
        },
        resolveVpsProviderId: (profileId: string): string => `vps-${profileId}`
      }
    })
    const loaded = await import('./runtimeConfigSync')
    sync = loaded.syncRuntimeConfigToCore
    regenerate = loaded.regenerateAndSyncProfile
  })

  beforeEach(() => {
    logs.length = 0
    calls.length = 0
    providerReloads.length = 0
  })

  after(() => {
    mock.restoreAll()
  })

  it('skips quietly while no runtime config has been generated', async () => {
    state.runtime = undefined

    assert.equal(await sync(), false)

    assert.deepEqual(calls, [])
    assert.match(logs[0], /skipped, runtime config has not been generated/)
  })

  it('reloads the whole config when the kernel holds a different number of rules, then drops cached pins', async () => {
    state.runtime = runtimeWith(5)
    state.liveRules = 3

    assert.equal(await sync(), true)

    assert.deepEqual(calls, ['reload', 'release:all'])
    assert.match(logs[0], /reloaded reason=live-rule-count-mismatch rules=3->5/)
  })

  it('leaves a kernel alone when it already runs the generated rules', async () => {
    state.liveRules = 5

    assert.equal(await sync(), false)

    assert.deepEqual(calls, [])
  })

  it('treats an unreachable controller as unknown rather than as a mismatch', async () => {
    state.liveRules = new Error('controller down')

    assert.equal(await sync(), false)

    assert.deepEqual(calls, [])
  })

  it('forces a reload when asked to, without comparing anything', async () => {
    state.liveRules = 5

    assert.equal(await sync({ force: true }), true)

    assert.deepEqual(calls, ['reload', 'release:all'])
    assert.match(logs[0], /reloaded reason=forced/)
  })

  it('only refreshes provider nodes after regenerating when rules and groups are unchanged', async () => {
    state.runtime = runtimeWith(5, ['vps-p1'])
    state.liveRules = 5
    await sync({ force: true })
    calls.length = 0

    assert.equal(await regenerate('p1'), false)

    assert.deepEqual(calls, ['generate'])
    assert.deepEqual(providerReloads, [['p1', true]])
  })

  it('reports that no VPS provider exists when the generated config has none', async () => {
    state.runtime = runtimeWith(5)
    await sync({ force: true })
    calls.length = 0

    assert.equal(await regenerate('p1'), false)

    assert.deepEqual(providerReloads, [['p1', false]])
  })

  it('reloads the whole config instead of refreshing providers when rules changed', async () => {
    state.runtime = runtimeWith(6)
    state.liveRules = 5

    assert.equal(await regenerate('p1'), true)

    assert.deepEqual(calls, ['generate', 'reload', 'release:all'])
    assert.deepEqual(providerReloads, [])
  })
})
