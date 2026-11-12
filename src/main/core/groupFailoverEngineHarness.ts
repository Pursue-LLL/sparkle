import type { FailoverGroupSnapshot, FailoverMemberSnapshot } from './groupFailoverCore'
import { createGroupFailoverEngine, type GroupFailoverDeps } from './groupFailoverEngine'

export const START = Date.parse('2026-11-11T12:00:00.000+08:00')
export const TAIWAN = 'Sparkle-台湾'

/** 让已排队的微任务（含引擎异步流程）全部执行完。 */
export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function leaf(name: string, delay: number, nowMs: number): FailoverMemberSnapshot {
  return {
    name,
    isGroup: false,
    history: [{ time: new Date(nowMs - 10_000).toISOString(), delay }]
  }
}

export function alertFor(group: string): ControllerLog {
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
export function createHarness(groups: Record<string, FailoverGroupSnapshot>) {
  let nowMs = START
  const pins: [group: string, node: string][] = []
  const unpins: string[] = []
  const logs: string[] = []
  const scheduled: ScheduledTask[] = []
  const listeners: ((log: ControllerLog) => void)[] = []
  const loads: string[] = []
  const load = { active: 0, maxActive: 0 }
  const behavior = {
    pinResult: true,
    loadError: undefined as Error | undefined,
    unpinError: undefined as Error | undefined,
    logError: undefined as Error | undefined,
    loadDelayMs: 0
  }

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
      if (behavior.unpinError) {
        throw behavior.unpinError
      }
      unpins.push(group)
      groups[group] = { ...groups[group], fixed: undefined }
    },
    log: async (line) => {
      if (behavior.logError) {
        throw behavior.logError
      }
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

export function taiwanGroup(now: string, fixed?: string): FailoverGroupSnapshot {
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
