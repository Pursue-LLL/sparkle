import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FAILOVER_HOLD_MS, type FailoverGroupSnapshot } from './groupFailoverCore'
import { createGroupFailoverEngine, type GroupFailoverDeps } from './groupFailoverEngine'
import { TAIWAN, alertFor, flush } from './groupFailoverEngineHarness'
import { forSeedsAsync, type Random } from './seededProperty'

const RUNS = 150
const STEPS = 30
const NODES = ['A', 'B', 'C', 'D', 'E']
const START = Date.parse('2026-11-12T08:00:00.000Z')

interface TimerEntry {
  task: () => void
  dueAt: number
  cancelled: boolean
  fired: boolean
}

/** 内存里的 url-test 组：记录谁固定了节点（用户 / 引擎），并在每次改选与释放时核对引擎的行为是否合理。 */
function createSession(random: Random) {
  let clock = START
  const kernel: { now: string; fixed: string | undefined; fixedBy: 'user' | 'engine' | undefined } =
    {
      now: random.pick(NODES),
      fixed: undefined,
      fixedBy: undefined
    }
  const delays = new Map(NODES.map((node) => [node, random.int(50, 400)]))
  const enginePinned = new Set<string>()
  const badUntil = new Map<string, number>()
  const violations: string[] = []
  const timers: TimerEntry[] = []
  const behavior = { pinResult: true, loadError: false, unpinError: false, logError: false }
  const counts = { pins: 0, unpins: 0 }
  let activeLoads = 0

  /** 成员的探测样本始终是新的：等价于内核持续健康检查。 */
  const snapshot = (): FailoverGroupSnapshot => ({
    name: TAIWAN,
    type: 'URLTest',
    now: kernel.now,
    fixed: kernel.fixed,
    members: NODES.map((name) => ({
      name,
      isGroup: false,
      history: [{ time: new Date(clock - 10_000).toISOString(), delay: delays.get(name) ?? 100 }]
    }))
  })

  const deps: GroupFailoverDeps = {
    subscribeAlerts: () => () => undefined,
    loadGroup: async () => {
      activeLoads += 1
      if (activeLoads > 1) violations.push('two tasks read the group at the same time')
      try {
        await Promise.resolve()
        if (behavior.loadError) throw new Error('controller unreachable')
        return snapshot()
      } finally {
        activeLoads -= 1
      }
    },
    pinNode: async (_group, node) => {
      counts.pins += 1
      if (node === kernel.now) violations.push(`pinned the failing node ${node}`)
      if ((badUntil.get(node) ?? 0) > clock) violations.push(`pinned quarantined node ${node}`)
      if (kernel.fixedBy === 'user' && kernel.fixed === kernel.now) {
        violations.push('pinned over a user pin')
      }
      await Promise.resolve()
      if (!behavior.pinResult) return false
      badUntil.set(kernel.now, clock + FAILOVER_HOLD_MS)
      Object.assign(kernel, { now: node, fixed: node, fixedBy: 'engine' })
      enginePinned.add(node)
      return true
    },
    unpinNode: async () => {
      counts.unpins += 1
      if (kernel.fixedBy === 'user') violations.push('released a pin the user set')
      await Promise.resolve()
      if (behavior.unpinError) throw new Error('unpin refused')
      Object.assign(kernel, { fixed: undefined, fixedBy: undefined })
    },
    log: async () => {
      if (behavior.logError) throw new Error('log disk full')
    },
    now: () => clock,
    schedule: (task, delayMs) => {
      const entry: TimerEntry = { task, dueAt: clock + delayMs, cancelled: false, fired: false }
      timers.push(entry)
      return () => {
        entry.cancelled = true
      }
    }
  }
  const engine = createGroupFailoverEngine(deps)

  return {
    engine,
    kernel,
    behavior,
    counts,
    violations,
    enginePinned,
    advance: (ms: number) => {
      clock += ms
    },
    fireDueTimers: (): number => {
      const due = timers.filter((entry) => !entry.cancelled && !entry.fired && entry.dueAt <= clock)
      for (const entry of due) {
        entry.fired = true
        entry.task()
      }
      return due.length
    },
    alert: () => {
      void engine.handleAlert(alertFor(TAIWAN))
    }
  }
}

describe('group failover engine under random interleavings', () => {
  async function runRandomSession(random: Random): Promise<void> {
    const session = createSession(random)
    const { kernel, behavior } = session

    const steps: (() => void)[] = [
      session.alert,
      session.alert,
      () => session.advance(random.pick([1_000, 31_000, 100_000, 400_000, FAILOVER_HOLD_MS + 1])),
      () => session.fireDueTimers(),
      () => {
        // 用户手动固定一个引擎没碰过的节点（引擎按节点名认领固定，同名无法区分）。
        const free = NODES.filter(
          (node) => node !== kernel.fixed && !session.enginePinned.has(node)
        )
        if (free.length === 0) return
        const node = random.pick(free)
        Object.assign(kernel, { now: node, fixed: node, fixedBy: 'user' })
      },
      () => Object.assign(kernel, { fixed: undefined, fixedBy: undefined }),
      () => {
        if (kernel.fixed === undefined) kernel.now = random.pick(NODES)
      },
      () => {
        behavior.pinResult = !behavior.pinResult
      },
      () => {
        behavior.loadError = !behavior.loadError
      },
      () => {
        behavior.unpinError = !behavior.unpinError
      },
      () => {
        behavior.logError = !behavior.logError
      }
    ]

    for (let step = 0; step < STEPS; step++) {
      random.pick(steps)()
      await flush()
      assert.deepEqual(session.violations, [])
    }

    // 故障全部消失后：引擎自己的固定必须被交还，且再次出现持续超时时仍能改选。
    Object.assign(behavior, {
      pinResult: true,
      loadError: false,
      unpinError: false,
      logError: false
    })
    for (let round = 0; round < 3; round++) {
      session.advance(FAILOVER_HOLD_MS + 1)
      session.fireDueTimers()
      await flush()
    }
    assert.deepEqual(session.violations, [])
    assert.notEqual(kernel.fixedBy, 'engine', 'the engine kept holding its own pin')

    const pinsBefore = session.counts.pins
    session.advance(FAILOVER_HOLD_MS + 1)
    session.alert()
    await flush()
    session.advance(40_000)
    session.alert()
    await flush()
    const userHoldsGroup = kernel.fixedBy === 'user' && kernel.fixed === kernel.now
    assert.equal(
      session.counts.pins - pinsBefore,
      userHoldsGroup ? 0 : 1,
      'the engine stopped reacting to persistent failures'
    )
    assert.deepEqual(session.violations, [])
  }

  it('never overrides a user pin, never re-picks a quarantined node, always hands its pin back', async () => {
    await forSeedsAsync(RUNS, (random) => runRandomSession(random))
  })
})
