import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { resolveDedicatedGroupSwitches } from './dedicatedGroups'
import { flush } from './groupFailoverEngineHarness'
import type { patchAppConfigAndReloadProfile as PatchAndReload } from './appConfigProfileReload'

/**
 * 真实的「落盘 → 生成 → 整配置重载 → 补探测」编排：只替换边缘依赖（配置库、生成与重载、各组探测、日志）。
 * `calls` 按真实发生顺序记录，用来验证串行与「重载成功后才补探测」。
 */

const calls: string[] = []
const logs: string[] = []
const state: {
  persisted: Partial<DedicatedGroupSwitches>
  generateFails: boolean
  syncResult: boolean
  syncFails: boolean
  syncGate: Promise<void> | undefined
  bootstrapGate: Promise<void> | undefined
  bootstrapFails: Set<string>
} = {
  persisted: {},
  generateFails: false,
  syncResult: true,
  syncFails: false,
  syncGate: undefined,
  bootstrapGate: undefined,
  bootstrapFails: new Set()
}

const RELOAD_ERROR = '分组开关已保存，但应用到网络失败，将在下次更新配置时生效'

/** 模拟配置库：补丁深合并进持久化状态，返回合并后的应用配置。 */
function applying(patch: Partial<AppConfig>, label = 'apply'): () => Promise<AppConfig> {
  return async () => {
    calls.push(label)
    state.persisted = { ...state.persisted, ...patch.dedicatedGroups }
    return { dedicatedGroups: { ...state.persisted } } as AppConfig
  }
}

function bootstrapOf(id: string): () => Promise<void> {
  return async () => {
    calls.push(`${id}:bootstrap`)
    await state.bootstrapGate
    if (state.bootstrapFails.has(id)) throw new Error(`${id} boom`)
  }
}

/**
 * 受控的「卡住」点：测试断言失败时也会被 afterEach 放行，否则串行队列会被遗留的未决任务堵死，
 * 后面的用例只会无限等待而不是失败。
 */
const heldGates: Array<() => void> = []
function hold(): { gate: Promise<void>; release: () => void } {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  heldGates.push(release)
  return { gate, release }
}

const flushAll = async (): Promise<void> => {
  for (let round = 0; round < 20; round++) {
    await flush()
  }
}

describe('patchAppConfigAndReloadProfile', () => {
  let patchAndReload: typeof PatchAndReload

  before(async () => {
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('./dedicatedGroupSwitch', {
      exports: {
        loadDedicatedGroupSwitches: async (): Promise<DedicatedGroupSwitches> =>
          resolveDedicatedGroupSwitches(state.persisted)
      }
    })
    mock.module('./factory', {
      exports: {
        generateProfile: async (): Promise<void> => {
          calls.push('generate')
          if (state.generateFails) throw new Error('generate boom')
        }
      }
    })
    mock.module('./runtimeConfigSync', {
      exports: {
        syncRuntimeConfigToCore: async (options: { force: boolean }): Promise<boolean> => {
          calls.push(`sync force=${options.force}`)
          await state.syncGate
          if (state.syncFails) throw new Error('sync boom')
          return state.syncResult
        }
      }
    })
    mock.module('./sparkleGrokProbe', {
      exports: { bootstrapSparkleGrokProvider: bootstrapOf('grok') }
    })
    mock.module('./sparkleGeminiProbe', {
      exports: { bootstrapSparkleGeminiRegionAudit: bootstrapOf('gemini') }
    })
    mock.module('./sparkleMailProbe', {
      exports: { bootstrapSparkleMailProvider: bootstrapOf('mail') }
    })
    mock.module('./sparkleAgyProbe', {
      exports: { bootstrapSparkleAgyProvider: bootstrapOf('agy') }
    })
    patchAndReload = (await import('./appConfigProfileReload')).patchAppConfigAndReloadProfile
  })

  beforeEach(() => {
    calls.length = 0
    logs.length = 0
    state.persisted = {}
    state.generateFails = false
    state.syncResult = true
    state.syncFails = false
    state.syncGate = undefined
    state.bootstrapGate = undefined
    state.bootstrapFails = new Set()
  })

  afterEach(async () => {
    for (const release of heldGates.splice(0)) {
      release()
    }
    await flushAll()
  })

  after(() => {
    mock.restoreAll()
  })

  it('applies a patch that leaves the runtime config alone without regenerating anything', async () => {
    const result = await patchAndReload({ saveLogs: true }, async () => {
      calls.push('apply')
      return { saveLogs: true } as AppConfig
    })

    assert.deepEqual(calls, ['apply'])
    assert.equal(result.saveLogs, true)
  })

  it('persists, regenerates and force-reloads the whole config for a switch patch', async () => {
    await patchAndReload(
      { dedicatedGroups: { gemini: false } },
      applying({ dedicatedGroups: { gemini: false } })
    )

    assert.deepEqual(calls, ['apply', 'generate', 'sync force=true'])
    assert.ok(
      logs.some((line) => line.includes('profile regenerated keys=dedicatedGroups reloaded=true'))
    )
  })

  it('kicks one probe round only for the groups that were just switched on, after the reload', async () => {
    state.persisted = { grok: false, agy: false, mail: true }

    await patchAndReload(
      { dedicatedGroups: { grok: true } },
      applying({ dedicatedGroups: { grok: true } })
    )
    await flushAll()

    assert.deepEqual(calls, ['apply', 'generate', 'sync force=true', 'grok:bootstrap'])
  })

  it('kicks nothing when a group is switched off, or when an on switch is re-sent', async () => {
    await patchAndReload(
      { dedicatedGroups: { agy: false } },
      applying({ dedicatedGroups: { agy: false } })
    )
    await patchAndReload(
      { dedicatedGroups: { mail: true } },
      applying({ dedicatedGroups: { mail: true } })
    )
    await flushAll()

    assert.deepEqual(
      calls.filter((call) => call.endsWith(':bootstrap')),
      []
    )
  })

  it('treats a core that did not take the new config as a failure, and does not probe', async () => {
    state.syncResult = false

    await assert.rejects(
      patchAndReload(
        { dedicatedGroups: { grok: true } },
        applying({ dedicatedGroups: { grok: true } })
      ),
      { message: RELOAD_ERROR }
    )
    await flushAll()

    assert.deepEqual(calls, ['apply', 'generate', 'sync force=true'])
    assert.ok(logs.some((line) => line.includes('reloaded=false')))
  })

  it('returns without waiting for the probe round it kicked off', async () => {
    const held = hold()
    state.bootstrapGate = held.gate

    const result = await patchAndReload(
      { dedicatedGroups: { grok: true } },
      applying({ dedicatedGroups: { grok: true } })
    )

    assert.equal(result.dedicatedGroups?.grok, true)
    held.release()
  })

  it('logs a failed probe round and still reports the switch as applied', async () => {
    state.bootstrapFails = new Set(['grok'])

    await assert.doesNotReject(
      patchAndReload(
        { dedicatedGroups: { grok: true } },
        applying({ dedicatedGroups: { grok: true } })
      )
    )
    await flushAll()

    assert.ok(logs.some((line) => line.includes('grok probe kick failed, grok boom')))
  })

  for (const failing of ['generate', 'sync'] as const) {
    it(`tells the user the switch was saved but not applied when ${failing} fails`, async () => {
      state.generateFails = failing === 'generate'
      state.syncFails = failing === 'sync'

      await assert.rejects(
        patchAndReload(
          { dedicatedGroups: { grok: true } },
          applying({ dedicatedGroups: { grok: true } })
        ),
        { message: RELOAD_ERROR }
      )
      await flushAll()

      assert.equal(state.persisted.grok, true, 'the switch itself stays saved')
      assert.equal(
        calls.some((call) => call.endsWith(':bootstrap')),
        false
      )
      assert.ok(logs.some((line) => line.includes('profile reload failed keys=dedicatedGroups')))
    })
  }

  it('keeps a failed Cursor path reload quiet: the patch is saved and only the log says why', async () => {
    state.generateFails = true

    const result = await patchAndReload(
      { cursorProxyAppPathPrefixes: ['/Applications/Foo.app'] },
      async () => {
        calls.push('apply')
        return { cursorProxyAppPathPrefixes: ['/Applications/Foo.app'] } as AppConfig
      }
    )

    assert.deepEqual(result.cursorProxyAppPathPrefixes, ['/Applications/Foo.app'])
    assert.ok(
      logs.some((line) => line.includes('profile reload failed keys=cursorProxyAppPathPrefixes'))
    )
  })

  it('keeps quiet when the core did not take a regenerated config for a Cursor path patch', async () => {
    state.syncResult = false

    await assert.doesNotReject(
      patchAndReload({ cursorProxyAppPathPrefixes: [] }, async () => {
        calls.push('apply')
        return { cursorProxyAppPathPrefixes: [] as string[] } as AppConfig
      })
    )

    assert.ok(
      logs.some((line) => line.includes('profile reload failed keys=cursorProxyAppPathPrefixes'))
    )
  })

  it('lets the next switch go through after one failed', async () => {
    state.generateFails = true
    await assert.rejects(
      patchAndReload(
        { dedicatedGroups: { grok: true } },
        applying({ dedicatedGroups: { grok: true } })
      )
    )

    state.generateFails = false
    await patchAndReload(
      { dedicatedGroups: { mail: false } },
      applying({ dedicatedGroups: { mail: false } })
    )

    assert.equal(calls.at(-1), 'sync force=true')
  })

  it('queues quick successive switches: each one finishes its reload before the next is saved', async () => {
    const held = hold()
    state.syncGate = held.gate

    const first = patchAndReload(
      { dedicatedGroups: { grok: true } },
      applying({ dedicatedGroups: { grok: true } }, 'apply:1')
    )
    const second = patchAndReload(
      { dedicatedGroups: { agy: false } },
      applying({ dedicatedGroups: { agy: false } }, 'apply:2')
    )
    await flushAll()
    assert.deepEqual(calls, ['apply:1', 'generate', 'sync force=true'], 'the second waits its turn')

    held.release()
    await Promise.all([first, second])
    await flushAll()

    assert.deepEqual(
      calls.filter((call) => call.startsWith('apply') || call === 'generate'),
      ['apply:1', 'generate', 'apply:2', 'generate']
    )
    assert.equal(calls.filter((call) => call.startsWith('sync')).length, 2)
    assert.ok(calls.indexOf('grok:bootstrap') > calls.indexOf('sync force=true'))
  })

  it('works out what was switched on from the state the previous switch left behind', async () => {
    const first = patchAndReload(
      { dedicatedGroups: { grok: true } },
      applying({ dedicatedGroups: { grok: true } }, 'apply:1')
    )
    const second = patchAndReload(
      { dedicatedGroups: { grok: true } },
      applying({ dedicatedGroups: { grok: true } }, 'apply:2')
    )
    await Promise.all([first, second])
    await flushAll()

    assert.equal(
      calls.filter((call) => call === 'grok:bootstrap').length,
      1,
      'only the first one switched it on'
    )
  })
})
