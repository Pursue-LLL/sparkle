import assert from 'node:assert/strict'
import { after, before, describe, it, mock } from 'node:test'
import { DIAL_FAILURE_DEDUPE_MS, FAILOVER_HOLD_MS } from './groupFailoverCore'
import { alertFor, flush, START, TAIWAN } from './groupFailoverEngineHarness'
import type { startGroupFailover } from './groupFailover'

interface Change {
  group: string
  node: string
  options: unknown
}

const logs: string[] = []
const listeners: ((log: ControllerLog) => void)[] = []
const changes: Change[] = []
const unfixes: string[] = []
let groups: ControllerMixedGroup[] = []
let changeAccepted = true

function leaf(name: string, delay: number): ControllerProxiesDetail {
  return {
    name,
    alive: delay > 0,
    history: [{ time: new Date(Date.now() - 10_000).toISOString(), delay }]
  } as ControllerProxiesDetail
}

function urlTestGroup(name: string, now: string): ControllerMixedGroup {
  return {
    name,
    type: 'URLTest',
    now,
    all: [leaf('A', 120), leaf('B', 200), leaf('C', 90), leaf('D', 150)]
  } as ControllerMixedGroup
}

function setGroup(name: string, patch: Partial<ControllerMixedGroup>): void {
  groups = groups.map((group) => (group.name === name ? { ...group, ...patch } : group))
}

/** 先越过上一轮告警的去重间隔，再在计数窗口内连发两次告警：触发一次转移。 */
async function alertTwice(group: string): Promise<void> {
  const emit = listeners[0]
  mock.timers.tick(DIAL_FAILURE_DEDUPE_MS + 1)
  emit(alertFor(group))
  mock.timers.tick(40_000)
  emit(alertFor(group))
  await flush()
}

describe('groupFailover wiring', () => {
  let start: typeof startGroupFailover

  before(async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START })
    mock.module('../utils/log', {
      exports: {
        appendAppLog: async (line: string): Promise<void> => {
          logs.push(line)
        }
      }
    })
    mock.module('./mihomoApi', {
      exports: {
        subscribeMihomoAlerts: (listener: (log: ControllerLog) => void): (() => void) => {
          listeners.push(listener)
          return () => undefined
        },
        mihomoGroups: async (): Promise<ControllerMixedGroup[]> => groups,
        mihomoChangeProxy: async (
          group: string,
          node: string,
          options: unknown
        ): Promise<boolean> => {
          changes.push({ group, node, options })
          if (changeAccepted) {
            setGroup(group, { now: node, fixed: node })
          }
          return changeAccepted
        },
        mihomoUnfixedProxy: async (group: string): Promise<void> => {
          unfixes.push(group)
          setGroup(group, { fixed: undefined })
        }
      }
    })
    start = (await import('./groupFailover')).startGroupFailover
  })

  after(() => {
    mock.timers.reset()
    mock.restoreAll()
  })

  it('subscribes to controller alerts once, however often it is started', () => {
    start()
    start()

    assert.equal(listeners.length, 1)
  })

  it('ignores alerts for groups the policy does not auto-switch', async () => {
    groups = [{ ...urlTestGroup('🚀 节点选择', 'A'), type: 'Selector' } as ControllerMixedGroup]

    await alertTwice('🚀 节点选择')

    assert.deepEqual(changes, [])
  })

  it('does nothing when the controller no longer knows the group', async () => {
    groups = []

    await alertTwice(TAIWAN)

    assert.deepEqual(changes, [])
    assert.deepEqual(logs, [])
  })

  it('does not hold or quarantine anything when the controller refuses the pin', async () => {
    groups = [urlTestGroup(TAIWAN, 'A')]
    changeAccepted = false

    await alertTwice(TAIWAN)

    assert.equal(changes.length, 1)
    assert.deepEqual(logs, [])
    changes.length = 0
    changeAccepted = true
  })

  it('pins a healthier node as an automatic change, then hands the group back after the hold', async () => {
    groups = [urlTestGroup(TAIWAN, 'A')]

    await alertTwice(TAIWAN)

    assert.deepEqual(changes, [{ group: TAIWAN, node: 'C', options: { source: 'auto' } }])
    assert.equal(logs.length, 1)
    assert.match(logs[0], /switched group=Sparkle-台湾 from=A to=C delay=90ms/)
    assert.deepEqual(unfixes, [])

    mock.timers.tick(FAILOVER_HOLD_MS - 1)
    await flush()
    assert.deepEqual(unfixes, [])

    mock.timers.tick(1)
    await flush()
    assert.deepEqual(unfixes, [TAIWAN])
    assert.match(logs[1], /released group=Sparkle-台湾 node=C/)
  })
})
