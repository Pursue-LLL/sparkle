import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRuntimeConfigSync } from './runtimeConfigSyncEngine'

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function configWith(rules: string[], providers?: Record<string, unknown>): MihomoConfig {
  return { rules, 'proxy-providers': providers } as unknown as MihomoConfig
}

const RULES_A = ['DOMAIN,a.example,DIRECT', 'GEOIP,CN,DIRECT', 'MATCH,自动选择']
const RULES_B = ['DOMAIN,b.example,DIRECT', 'GEOIP,CN,DIRECT', 'MATCH,自动选择']
const MORE_RULES = [...RULES_A, 'DOMAIN,extra.example,DIRECT']

interface Behavior {
  runtime: MihomoConfig | undefined
  /** 内核当前规则数；Error 表示控制器不可用。 */
  live: number | Error
  reloadError: Error | undefined
  generateError: Error | undefined
  runtimeError: Error | undefined
  reloadGate: Promise<void> | undefined
  logError: Error | undefined
}

/** 内存里模拟内核：整配置重载后内核规则数追平磁盘配置。 */
function createHarness(runtime: MihomoConfig | undefined, live: number | Error) {
  const behavior: Behavior = {
    runtime,
    live,
    reloadError: undefined,
    generateError: undefined,
    runtimeError: undefined,
    reloadGate: undefined,
    logError: undefined
  }
  const events: string[] = []
  const logs: string[] = []
  const runtimeReads = { count: 0 }

  const sync = createRuntimeConfigSync({
    generateProfile: async () => {
      events.push('generate')
      if (behavior.generateError) {
        throw behavior.generateError
      }
    },
    getRuntimeConfig: async () => {
      runtimeReads.count += 1
      if (behavior.runtimeError) {
        const error = behavior.runtimeError
        behavior.runtimeError = undefined
        throw error
      }
      return behavior.runtime
    },
    liveRuleCount: async () => {
      events.push('live')
      if (behavior.live instanceof Error) {
        throw behavior.live
      }
      return behavior.live
    },
    reloadFromDisk: async () => {
      events.push('reload')
      await behavior.reloadGate
      if (behavior.reloadError) {
        throw behavior.reloadError
      }
      behavior.live = behavior.runtime?.rules?.length ?? 0
    },
    releaseCachedPins: async () => {
      events.push('release')
    },
    reloadProviders: async (profileId, hasVpsProvider) => {
      events.push(`providers:${profileId}:${hasVpsProvider}`)
    },
    resolveVpsProviderId: (profileId) => `vps-${profileId}`,
    log: async (line) => {
      if (behavior.logError) {
        throw behavior.logError
      }
      logs.push(line)
    }
  })
  return { ...sync, behavior, events, logs, runtimeReads }
}

describe('runtime config sync: sync', () => {
  it('skips and says so while no runtime config has been generated', async () => {
    const h = createHarness(undefined, 3)

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.logs, [
      '[RuntimeConfigSync]: skipped, runtime config has not been generated\n'
    ])
    assert.deepEqual(h.events, [])
  })

  it('leaves a kernel that already matches disk alone and stays quiet', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.events, ['live'])
    assert.deepEqual(h.logs, [])
  })

  it('reloads a kept stale kernel whose rule count disagrees with disk, then frees cached pins', async () => {
    const h = createHarness(configWith(MORE_RULES), 2)

    assert.equal(await h.sync(), true)
    assert.deepEqual(h.events, ['live', 'reload', 'release'])
    assert.deepEqual(h.logs, [
      '[RuntimeConfigSync]: reloaded reason=live-rule-count-mismatch rules=2->4\n'
    ])
  })

  it('reloads when the config changed inside this process even if the rule count is the same', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    assert.equal(await h.sync(), false)

    h.behavior.runtime = configWith(RULES_B)
    assert.equal(await h.sync(), true)
    assert.deepEqual(h.logs, ['[RuntimeConfigSync]: reloaded reason=config-changed rules=3->3\n'])
  })

  it('leaves the same config alone once the kernel has adopted it', async () => {
    const h = createHarness(configWith(MORE_RULES), 2)
    assert.equal(await h.sync(), true)
    h.events.length = 0

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.events, ['live'])
  })

  it('reloads once per config change, not on every later sync', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    assert.equal(await h.sync(), false)

    h.behavior.runtime = configWith(RULES_B)
    assert.equal(await h.sync(), true)
    h.events.length = 0

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.events, ['live'])
  })

  it('counts a config without rules as zero rules', async () => {
    const h = createHarness({} as unknown as MihomoConfig, 0)

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.events, ['live'])
  })

  it('reports an empty kernel as zero rules rather than unknown', async () => {
    const h = createHarness(configWith(RULES_A), 0)

    assert.equal(await h.sync(), true)
    assert.deepEqual(h.logs, [
      '[RuntimeConfigSync]: reloaded reason=live-rule-count-mismatch rules=0->3\n'
    ])
  })

  it('reloads without comparing when forced, even though disk and kernel agree', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)

    assert.equal(await h.sync({ force: true }), true)
    assert.deepEqual(h.events, ['live', 'reload', 'release'])
    assert.deepEqual(h.logs, ['[RuntimeConfigSync]: reloaded reason=forced rules=3->3\n'])
  })

  it('does not guess when the controller is unreachable, but still honours a forced reload', async () => {
    const h = createHarness(configWith(RULES_A), new Error('controller down'))

    assert.equal(await h.sync(), false)
    assert.deepEqual(h.events, ['live'])
    assert.deepEqual(h.logs, [])

    assert.equal(await h.sync({ force: true }), true)
    assert.deepEqual(h.logs, ['[RuntimeConfigSync]: reloaded reason=forced rules=unknown->3\n'])
  })

  it('only trusts a config as applied after the kernel could be asked about it', async () => {
    const h = createHarness(configWith(RULES_A), new Error('controller down'))
    assert.equal(await h.sync(), false)

    h.behavior.runtime = configWith(RULES_B)
    h.behavior.live = RULES_B.length
    assert.equal(await h.sync(), false)
    assert.deepEqual(h.logs, [])

    h.behavior.runtime = configWith(RULES_A)
    assert.equal(await h.sync(), true)
    assert.deepEqual(h.logs, ['[RuntimeConfigSync]: reloaded reason=config-changed rules=3->3\n'])
  })

  it('records a failed reload, keeps the old fingerprint and retries on the next call', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    assert.equal(await h.sync(), false)

    h.behavior.runtime = configWith(RULES_B)
    h.behavior.reloadError = new Error('reload refused')
    assert.equal(await h.sync(), false)
    assert.deepEqual(h.logs, [
      '[RuntimeConfigSync]: reload failed reason=config-changed err=reload refused\n'
    ])
    assert.equal(h.events.includes('release'), false)

    h.behavior.reloadError = undefined
    assert.equal(await h.sync(), true)
    assert.equal(h.events.filter((event) => event === 'reload').length, 2)
    assert.equal(h.events.at(-1), 'release')
  })

  it('never lets a failing logger change what gets reloaded', async () => {
    const h = createHarness(configWith(MORE_RULES), 2)
    h.behavior.logError = new Error('disk full')

    assert.equal(await h.sync(), true)
    assert.deepEqual(h.events, ['live', 'reload', 'release'])
    assert.equal(await h.sync(), false)
  })

  it('runs overlapping requests one after another', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    let openGate: () => void = () => undefined
    h.behavior.reloadGate = new Promise<void>((resolve) => {
      openGate = resolve
    })

    const first = h.sync({ force: true })
    const second = h.sync({ force: true })
    await flush()
    assert.equal(h.runtimeReads.count, 1)
    assert.deepEqual(h.events, ['live', 'reload'])

    openGate()
    assert.deepEqual(await Promise.all([first, second]), [true, true])
    assert.equal(h.runtimeReads.count, 2)
  })

  it('keeps serving later requests after one request fails', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    h.behavior.runtimeError = new Error('config unavailable')
    const failing = h.sync()
    const following = h.sync({ force: true })

    await assert.rejects(failing, /config unavailable/)
    assert.equal(await following, true)
  })
})

describe('runtime config sync: regenerateAndSync', () => {
  it('regenerates first and skips the provider refresh when the kernel was reloaded', async () => {
    const h = createHarness(configWith(MORE_RULES), 2)

    assert.equal(await h.regenerateAndSync('p1'), true)
    assert.deepEqual(h.events, ['generate', 'live', 'reload', 'release'])
  })

  it('only refreshes provider nodes when nothing needs a full reload', async () => {
    const h = createHarness(configWith(RULES_A, { 'vps-p1': { type: 'file' } }), RULES_A.length)

    assert.equal(await h.regenerateAndSync('p1'), false)
    assert.deepEqual(h.events, ['generate', 'live', 'providers:p1:true'])
  })

  it('tells the refresh when the profile has no VPS provider', async () => {
    const h = createHarness(configWith(RULES_A, { other: { type: 'file' } }), RULES_A.length)
    assert.equal(await h.regenerateAndSync('p1'), false)

    const bare = createHarness(configWith(RULES_A), RULES_A.length)
    assert.equal(await bare.regenerateAndSync('p2'), false)

    assert.equal(h.events.at(-1), 'providers:p1:false')
    assert.equal(bare.events.at(-1), 'providers:p2:false')
  })

  it('still refreshes providers when no runtime config exists after regenerating', async () => {
    const h = createHarness(undefined, 3)

    assert.equal(await h.regenerateAndSync('p1'), false)
    assert.deepEqual(h.events, ['generate', 'providers:p1:false'])
  })

  it('stops at a failed regeneration and keeps working afterwards', async () => {
    const h = createHarness(configWith(RULES_A), RULES_A.length)
    h.behavior.generateError = new Error('generate failed')

    await assert.rejects(h.regenerateAndSync('p1'), /generate failed/)
    assert.deepEqual(h.events, ['generate'])

    h.behavior.generateError = undefined
    assert.equal(await h.regenerateAndSync('p1'), false)
  })
})
