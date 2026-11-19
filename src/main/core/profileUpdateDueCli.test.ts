import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { AGY_HEADLESS_DEADLINE_MS } from './sparkleAgyProbeCore'

const NOW = 1_700_000_000_000
const HARD_STOP_GRACE_MS = 15_000

const world = {
  /** 各依赖被调用的先后，用来钉死「订阅刷新 → agy 巡检 → 退出」的次序。 */
  order: [] as string[],
  updatedCount: 2,
  updateFailure: undefined as Error | undefined,
  agyEnabled: true,
  gateFailure: undefined as Error | undefined,
  /** 一次订阅刷新要花多久（假时钟下推进）。 */
  updateDurationMs: 0,
  dutyBehavior: 'finish' as 'finish' | 'throw' | 'hang',
  dutyDeadlines: [] as Array<number | undefined>,
  logs: [] as string[]
}

function resetWorld(): void {
  world.order = []
  world.updatedCount = 2
  world.updateFailure = undefined
  world.agyEnabled = true
  world.gateFailure = undefined
  world.updateDurationMs = 0
  world.dutyBehavior = 'finish'
  world.dutyDeadlines = []
  world.logs = []
}

let runProfileUpdateDueCli: () => Promise<number>

before(() => {
  mock.module('./manager', {
    exports: {
      quitWithoutCore: async () => {
        world.order.push('quit')
      }
    }
  })
  mock.module('./profileUpdater', {
    exports: {
      runDueProfileUpdates: async () => {
        world.order.push('updates')
        mock.timers.tick(world.updateDurationMs)
        if (world.updateFailure) {
          throw world.updateFailure
        }
        return world.updatedCount
      }
    }
  })
  mock.module('./coreReadinessGate', {
    exports: { runCoreReadinessPipeline: async () => ({ startPromise: Promise.resolve() }) }
  })
  mock.module('./dedicatedGroupSwitch', {
    exports: {
      dedicatedGroupGate: (id: string) => async () => {
        assert.equal(id, 'agy', '无头进程只维护 agy 出口')
        if (world.gateFailure) {
          throw world.gateFailure
        }
        return world.agyEnabled
      }
    }
  })
  mock.module('./sparkleAgyProbe', {
    exports: {
      runSparkleAgyDueDuty: async (options: { deadlineAtMs?: number }) => {
        world.order.push('duty')
        world.dutyDeadlines.push(options.deadlineAtMs)
        if (world.dutyBehavior === 'throw') {
          throw new Error('duty exploded')
        }
        if (world.dutyBehavior === 'hang') {
          await new Promise<never>(() => {
            // 永不落定：模拟卡住的环节。
          })
        }
      }
    }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string) => {
        world.logs.push(line)
      }
    }
  })
  mock.module('../sys/guiGracefulQuitMarker', {
    exports: {
      markGracefulGuiQuit: () => {
        world.order.push('mark')
      }
    }
  })
  runProfileUpdateDueCli = require('./profileUpdateDueCli').runProfileUpdateDueCli
})

beforeEach(() => {
  resetWorld()
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW })
})
afterEach(() => {
  mock.timers.reset()
})

/** 让一次性进程的 await 链跑到下一个需要时钟的地方。 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await nextTurn()
  }
}

const logged = (fragment: string): boolean => world.logs.some((line) => line.includes(fragment))

describe('runProfileUpdateDueCli', () => {
  it('refreshes subscriptions, then maintains the agy exit, then quits', async () => {
    const updated = await runProfileUpdateDueCli()

    assert.equal(updated, 2)
    assert.deepEqual(world.order, ['updates', 'duty', 'mark', 'quit'])
  })

  it('counts the agy deadline from the start of the process, not from when the duty begins', async () => {
    world.updateDurationMs = 2 * 60_000

    await runProfileUpdateDueCli()

    assert.deepEqual(world.dutyDeadlines, [NOW + AGY_HEADLESS_DEADLINE_MS])
  })

  it('maintains the agy exit even when refreshing subscriptions fails, and still reports the failure', async () => {
    world.updateFailure = new Error('subscription server down')

    await assert.rejects(runProfileUpdateDueCli(), { message: 'subscription server down' })

    assert.deepEqual(world.order, ['updates', 'duty', 'mark', 'quit'])
    assert.ok(logged('failed: subscription server down'))
  })

  it('leaves the agy exit alone while its group is off', async () => {
    world.agyEnabled = false

    await runProfileUpdateDueCli()

    assert.deepEqual(world.order, ['updates', 'mark', 'quit'])
  })

  it('logs a failing duty and still finishes the run', async () => {
    world.dutyBehavior = 'throw'

    const updated = await runProfileUpdateDueCli()

    assert.equal(updated, 2)
    assert.ok(logged('agy duty failed: duty exploded'))
    assert.deepEqual(world.order, ['updates', 'duty', 'mark', 'quit'])
  })

  it('logs a switch it cannot read and still finishes the run', async () => {
    world.gateFailure = new Error('config unreadable')

    await runProfileUpdateDueCli()

    assert.ok(logged('agy duty failed: config unreadable'))
    assert.deepEqual(world.order, ['updates', 'mark', 'quit'])
  })

  it(
    'abandons a duty that hangs shortly after its deadline instead of outliving the next schedule',
    { timeout: 10_000 },
    async () => {
      world.dutyBehavior = 'hang'
      let finished = false
      const run = runProfileUpdateDueCli().then(() => {
        finished = true
      })
      await settle()
      assert.equal(finished, false, 'the duty is still within its deadline')

      mock.timers.tick(AGY_HEADLESS_DEADLINE_MS + HARD_STOP_GRACE_MS - 1)
      await settle()
      assert.equal(finished, false, 'one millisecond before the hard stop')

      mock.timers.tick(1)
      await run

      assert.ok(logged('agy duty overran its deadline'))
      assert.deepEqual(world.order, ['updates', 'duty', 'mark', 'quit'])
    }
  )
})
