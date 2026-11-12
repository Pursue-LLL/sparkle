import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as settle } from 'node:timers/promises'

const HEARTBEAT_MS = 5 * 60 * 1000
const STARTUP_DELAY_MS = 60 * 1000

/** updated 远早于任何计划时刻：每次检查都到期，便于数更新次数。 */
const dueItem = (): ProfileItem => ({
  id: 'main',
  name: '主订阅',
  type: 'remote',
  url: 'https://example.com/sub',
  autoUpdate: true,
  updateTime: '07:00',
  updated: 1
})

const world: {
  items: ProfileItem[]
  listFailure: unknown
  updated: string[]
  logs: string[]
} = { items: [], listFailure: undefined, updated: [], logs: [] }

let moduleMocked = false

function loadModule(): typeof import('./profileUpdater') {
  if (!moduleMocked) {
    mock.module('../config', {
      exports: {
        getProfileConfig: async () => {
          if (world.listFailure !== undefined) {
            throw world.listFailure
          }
          return { items: world.items }
        },
        addProfileItem: async (item: ProfileItem) => {
          world.updated.push(item.id)
        }
      }
    })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (message: string) => {
          world.logs.push(message)
        }
      }
    })
    moduleMocked = true
  }
  delete require.cache[require.resolve('./profileUpdater')]
  return require('./profileUpdater')
}

/** 推进假时钟后让心跳回调里的 await 链跑完（timers/promises 的 setImmediate 不受假时钟影响）。 */
async function advance(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await settle()
}

describe('profileUpdater', () => {
  beforeEach(() => {
    world.items = [dueItem()]
    world.listFailure = undefined
    world.updated = []
    world.logs = []
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 10, 12, 12, 0, 0) })
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('waits for the startup delay, then checks every five minutes', async () => {
    loadModule().initProfileUpdater()

    await advance(STARTUP_DELAY_MS - 1)
    assert.deepEqual(world.updated, [])

    await advance(1)
    assert.deepEqual(world.updated, ['main'])

    await advance(HEARTBEAT_MS - 1)
    assert.deepEqual(world.updated, ['main'])

    await advance(1)
    assert.deepEqual(world.updated, ['main', 'main'])
    assert.ok(world.logs.some((line) => line.includes('update succeeded id=main')))
  })

  it('logs a failed heartbeat and keeps the schedule going', async () => {
    world.listFailure = new Error('profile config unreadable')
    loadModule().initProfileUpdater()

    await advance(STARTUP_DELAY_MS)
    assert.deepEqual(world.logs, [
      '[ProfileUpdater]: heartbeat failed: profile config unreadable\n'
    ])

    world.listFailure = undefined
    await advance(HEARTBEAT_MS)
    assert.deepEqual(world.updated, ['main'])
  })

  it('describes a thrown non-Error value in the failure log', async () => {
    world.listFailure = 'plain string failure'
    loadModule().initProfileUpdater()

    await advance(STARTUP_DELAY_MS)

    assert.deepEqual(world.logs, ['[ProfileUpdater]: heartbeat failed: plain string failure\n'])
  })

  it('restarts the startup delay when initialised again', async () => {
    const { initProfileUpdater } = loadModule()
    initProfileUpdater()
    await advance(30_000)

    initProfileUpdater()
    await advance(30_000)
    assert.deepEqual(world.updated, [])

    await advance(30_000)
    assert.deepEqual(world.updated, ['main'])
  })

  it('shares one run between concurrent callers of runDueProfileUpdates', async () => {
    const { runDueProfileUpdates } = loadModule()

    const results = await Promise.all([runDueProfileUpdates(), runDueProfileUpdates()])

    assert.deepEqual(results, [1, 1])
    assert.deepEqual(world.updated, ['main'])
  })
})
