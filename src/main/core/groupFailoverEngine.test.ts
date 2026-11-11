import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DIAL_FAILURE_DEDUPE_MS,
  FAILOVER_HOLD_MS,
  type FailoverGroupSnapshot,
  type FailoverMemberSnapshot
} from './groupFailoverCore'
import { createGroupFailoverEngine, type GroupFailoverDeps } from './groupFailoverEngine'

const START = Date.parse('2026-11-11T12:00:00.000+08:00')
const TAIWAN = 'Sparkle-台湾'

/** 让已排队的微任务（含引擎异步流程）全部执行完。 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function leaf(name: string, delay: number, nowMs: number): FailoverMemberSnapshot {
  return {
    name,
    isGroup: false,
    history: [{ time: new Date(nowMs - 10_000).toISOString(), delay }]
  }
}

function alertFor(group: string): ControllerLog {
  return {
    type: 'warning',
    payload: `because ${group} failed multiple times, activate health check`
  }
}

interface ScheduledTask {
  task: () => void
  delayMs: number
  cancelled: boolean
}

/** 用内存里的分组状态模拟内核：改选后 now / fixed 同步变化。 */
function createHarness(groups: Record<string, FailoverGroupSnapshot>) {
  let nowMs = START
  const pins: [group: string, node: string][] = []
  const unpins: string[] = []
  const logs: string[] = []
  const scheduled: ScheduledTask[] = []
  const listeners: ((log: ControllerLog) => void)[] = []
  const loads: string[] = []
  const load = { active: 0, maxActive: 0 }
  const behavior = { pinResult: true, loadError: undefined as Error | undefined, loadDelayMs: 0 }

  const deps: GroupFailoverDeps = {
    subscribeAlerts: (listener) => {
      listeners.push(listener)
      return () => undefined
    },
    loadGroup: async (name) => {
      loads.push(name)
      load.active += 1
      load.maxActive = Math.max(load.maxActive, load.active)
      try {
        if (behavior.loadDelayMs > 0) {
          await sleep(behavior.loadDelayMs)
        }
        if (behavior.loadError) {
          throw behavior.loadError
        }
        return groups[name]
      } finally {
        load.active -= 1
      }
    },
    pinNode: async (group, node) => {
      pins.push([group, node])
      if (behavior.pinResult) {
        groups[group] = { ...groups[group], now: node, fixed: node }
      }
      return behavior.pinResult
    },
    unpinNode: async (group) => {
      unpins.push(group)
      groups[group] = { ...groups[group], fixed: undefined }
    },
    log: async (line) => {
      logs.push(line)
    },
    now: () => nowMs,
    schedule: (task, delayMs) => {
      const entry: ScheduledTask = { task, delayMs, cancelled: false }
      scheduled.push(entry)
      return () => {
        entry.cancelled = true
      }
    }
  }
  const engine = createGroupFailoverEngine(deps)
  return {
    engine,
    groups,
    pins,
    unpins,
    logs,
    scheduled,
    listeners,
    loads,
    load,
    behavior,
    advance: (ms: number) => {
      nowMs += ms
    },
    /** 间隔 40 s 的两次告警：触发一次转移。 */
    async failTwice(group: string): Promise<void> {
      await engine.handleAlert(alertFor(group))
      nowMs += 40_000
      await engine.handleAlert(alertFor(group))
    }
  }
}

function taiwanGroup(now: string, fixed?: string): FailoverGroupSnapshot {
  return {
    name: TAIWAN,
    type: 'URLTest',
    now,
    fixed,
    members: [
      leaf('A', 120, START),
      leaf('B', 200, START),
      leaf('C', 90, START),
      leaf('D', 150, START)
    ]
  }
}

describe('group failover engine', () => {
  it('switches the group to the fastest healthy node after two failed bursts and pins it', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.engine.handleAlert(alertFor(TAIWAN))
    assert.deepEqual(h.pins, [])
    h.advance(40_000)
    await h.engine.handleAlert(alertFor(TAIWAN))
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
    assert.equal(h.scheduled.length, 1)
    assert.equal(h.scheduled[0].delayMs, FAILOVER_HOLD_MS)
    assert.match(h.logs.join(''), /switched group=Sparkle-台湾 from=A to=C delay=90ms/)
  })

  it('does not switch on a single alert or a burst of simultaneous alerts', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    for (let index = 0; index < 8; index += 1) {
      await h.engine.handleAlert(alertFor(TAIWAN))
    }
    assert.deepEqual(h.pins, [])
    assert.deepEqual(h.loads, [])
  })

  it('ignores alerts for groups the policy does not fail over and unrelated logs', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    for (const group of ['自动选择', '🎯 Cursor 专用', 'grok 专用', '订阅自带组']) {
      await h.failTwice(group)
    }
    await h.engine.handleAlert({ type: 'warning', payload: 'something else entirely' })
    assert.deepEqual(h.loads, [])
    assert.deepEqual(h.pins, [])
  })

  it('quarantines the failing node so a later failover moves on to the next best node', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'D'])

    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'B'])
  })

  it('releases the quarantine after the hold time', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'C'])
    h.advance(FAILOVER_HOLD_MS)
    h.groups[TAIWAN] = taiwanGroup('C', 'C')
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'A'])
  })

  it('replaces its own earlier pin and cancels the old release timer', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.equal(h.scheduled.length, 2)
    assert.equal(h.scheduled[0].cancelled, true)
    assert.equal(h.scheduled[1].cancelled, false)
  })

  it('leaves a user pin alone and says why', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A', 'A') })
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [])
    assert.deepEqual(h.scheduled, [])
    assert.match(h.logs.join(''), /skipped group=Sparkle-台湾 reason=user-pin node=A/)
  })

  it('records nothing when the pin is refused', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.behavior.pinResult = false
    await h.failTwice(TAIWAN)
    assert.equal(h.pins.length, 1)
    assert.deepEqual(h.scheduled, [])
    assert.doesNotMatch(h.logs.join(''), /switched/)

    h.behavior.pinResult = true
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins.at(-1), [TAIWAN, 'C'])
  })

  it('hands the group back to the kernel when the hold expires and the pin is still ours', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [TAIWAN])
    assert.match(h.logs.join(''), /released group=Sparkle-台湾 node=C/)
  })

  it('does not unpin when the user or another flow has changed the pin meanwhile', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    await h.failTwice(TAIWAN)
    h.groups[TAIWAN] = taiwanGroup('D', 'D')
    h.scheduled[0].task()
    await flush()
    assert.deepEqual(h.unpins, [])
  })

  it('survives a failing controller call and keeps handling later failovers', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.behavior.loadError = new Error('controller down')
    await h.failTwice(TAIWAN)
    assert.match(h.logs.join(''), /failover failed group=Sparkle-台湾 err=controller down/)

    h.behavior.loadError = undefined
    h.advance(DIAL_FAILURE_DEDUPE_MS)
    await h.failTwice(TAIWAN)
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
  })

  it('runs failovers for different groups one after another', async () => {
    const japan = { ...taiwanGroup('A'), name: 'Sparkle-日本' }
    const h = createHarness({ [TAIWAN]: taiwanGroup('A'), 'Sparkle-日本': japan })
    h.behavior.loadDelayMs = 5
    await Promise.all([h.failTwice(TAIWAN), h.failTwice('Sparkle-日本')])
    assert.deepEqual(h.pins.map(([group]) => group).sort(), [TAIWAN, 'Sparkle-日本'].sort())
    assert.equal(h.load.maxActive, 1)
  })

  it('subscribes once and feeds subscribed alerts into the engine', async () => {
    const h = createHarness({ [TAIWAN]: taiwanGroup('A') })
    h.engine.start()
    h.engine.start()
    assert.equal(h.listeners.length, 1)
    h.listeners[0](alertFor(TAIWAN))
    h.advance(40_000)
    h.listeners[0](alertFor(TAIWAN))
    await flush()
    assert.deepEqual(h.pins, [[TAIWAN, 'C']])
  })
})
