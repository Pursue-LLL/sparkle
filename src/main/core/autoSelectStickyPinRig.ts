// [INPUT] node:test 假时钟与模块替身 · autoSelectStickyPin / autoSelectQualityGuard（被测模块，每个用例重新加载） ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         sparkleNodeQualityCore::ThroughputReading (POS: 节点质量闸门纯决策层)
// [OUTPUT] useStickyPinRig · world · poll/jump/settle · 断言辅助（callsStarting/changes/unfixes/measures）· DELAY_ALIVE/DELAY_DEAD · aliveLeaf/deadLeaf · ELIGIBLE/restricted ·
//          吞吐读数脚本（measured/UNAVAILABLE/scriptReadings）
// [POS] autoSelectStickyPin 行为测试夹具：用可脚本化的 mihomo 控制器、地区校验、吞吐探测与沉底缓存替身，
// 在假时钟上驱动 3 秒轮询。默认把质量闸门换成直通桩（只测固定逻辑）；`guard: 'real'` 时运行真实闸门。
// 仅供测试使用。

import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, mock } from 'node:test'
import { AUTO_SELECT_DELAY_PROBE_URL } from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import type { ThroughputReading } from './sparkleNodeQualityCore'
import type * as QualityGuard from './autoSelectQualityGuard'
import type * as StickyPin from './autoSelectStickyPin'

export const POLL_INTERVAL_MS = 3000

export const DELAY_ALIVE = { [AUTO_SELECT_DELAY_PROBE_URL]: { alive: true } }
export const DELAY_DEAD = { [AUTO_SELECT_DELAY_PROBE_URL]: { alive: false } }

interface GroupSnapshot {
  type: string
  now: string
  fixed?: string
  all: string[]
}

export interface Leaf {
  name: string
  alive?: boolean
  extra?: Record<string, { alive: boolean; history?: Array<{ delay: number }> }>
}

/** 有测速成功样本的存活节点：质量闸门只会拿这样的节点当替代候选。 */
export const aliveLeaf = (name: string): Leaf => ({
  name,
  alive: true,
  extra: { [AUTO_SELECT_DELAY_PROBE_URL]: { alive: true, history: [{ delay: 100 }] } }
})

/** 测过速但当前判定不存活的节点。 */
export const deadLeaf = (name: string): Leaf => ({
  name,
  alive: false,
  extra: { [AUTO_SELECT_DELAY_PROBE_URL]: { alive: false, history: [{ delay: 100 }] } }
})

interface RegionVerdict {
  eligible: boolean
  countryCode?: string
  definitive: boolean
}

export const ELIGIBLE: RegionVerdict = { eligible: true, countryCode: 'TW', definitive: true }
export const restricted = (countryCode: string): RegionVerdict => ({
  eligible: false,
  countryCode,
  definitive: true
})

export type ProbeRole = 'primary' | 'control'
const GOOGLE_TARGET = { host: 'primary.test', path: '/' }
const CONTROL_TARGET = { host: 'control.test', path: '/' }

export const measured = (kbps: number): ThroughputReading => ({ kind: 'measured', kbps })
export const UNAVAILABLE: ThroughputReading = { kind: 'unavailable' }
const HEALTHY = measured(400)

export type ReadingScript = Record<string, Partial<Record<ProbeRole, ThroughputReading>>>

export const world = {
  group: { type: 'Fallback', now: 'A', all: ['A', 'B'] } as GroupSnapshot,
  leaves: [] as Leaf[],
  delayOf: (_node: string): number | Error => 120,
  regionOf: (_node: string): RegionVerdict => ELIGIBLE,
  readingOf: (_node: string, _role: ProbeRole): ThroughputReading => HEALTHY,
  onMeasure: undefined as undefined | ((node: string, role: ProbeRole) => void | Promise<void>),
  /** 控制器读 provider 时抛出的任意值（真实世界里 reject 的不一定是 Error）。 */
  providersError: undefined as unknown,
  /** 为 false 时控制器的 provider 列表里没有 sparkle-fast（例如配置刚重载完）。 */
  fastProviderListed: true,
  closeError: undefined as Error | undefined,
  sunk: new Set<string>(),
  detailError: undefined as Error | undefined,
  onDetail: undefined as undefined | ((call: number) => void | Promise<void>),
  detailCalls: 0,
  calls: [] as string[],
  logs: [] as string[]
}

/** 脚本化探针读数：表里没写的节点与目标都是健康读数。 */
export const scriptReadings = (table: ReadingScript): void => {
  world.readingOf = (node, role) => table[node]?.[role] ?? HEALTHY
}

function resetWorld(): void {
  world.group = { type: 'Fallback', now: 'A', all: ['A', 'B'] }
  world.leaves = []
  world.delayOf = () => 120
  world.regionOf = () => ELIGIBLE
  world.readingOf = () => HEALTHY
  world.onMeasure = undefined
  world.providersError = undefined
  world.fastProviderListed = true
  world.closeError = undefined
  world.sunk = new Set()
  world.detailError = undefined
  world.onDetail = undefined
  world.detailCalls = 0
  world.calls = []
  world.logs = []
}

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))
export const changes = (): string[] => callsStarting('change:').map((call) => call.split(':')[2])
export const unfixes = (): string[] => callsStarting('unfix:')
export const measures = (): string[] => callsStarting('measure:')

export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await flush()
  }
}

/** 推进若干个轮询周期，每个周期等这一轮跑完。 */
export async function poll(count = 1): Promise<void> {
  for (let round = 0; round < count; round++) {
    mock.timers.tick(POLL_INTERVAL_MS)
    await settle()
  }
}

/** 一次跨过很长时间：期间到期的定时器回调同步执行，只有第一个会真正开始一轮。 */
export async function jump(ms: number): Promise<void> {
  mock.timers.tick(ms)
  await settle()
}

function installGuardStub(): void {
  mock.module('./autoSelectQualityGuard', {
    exports: {
      admitPinCandidate: async (candidate: string) => ({
        node: candidate,
        verified: true,
        sunk: [],
        abandoned: undefined
      }),
      settlePinAdmission: async (): Promise<void> => undefined,
      reviewPinnedNode: async (): Promise<void> => undefined,
      observePinnedNode: (): void => undefined,
      resetQualityGuard: (): void => undefined
    }
  })
}

function installMocks(guard: 'stub' | 'real'): void {
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        world.logs.push(line)
      }
    }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoGroupDetail: async (name: string): Promise<GroupSnapshot> => {
        world.detailCalls += 1
        world.calls.push(`detail:${name}`)
        if (world.detailError) {
          throw world.detailError
        }
        await world.onDetail?.(world.detailCalls)
        return { ...world.group, all: [...world.group.all] }
      },
      mihomoChangeProxy: async (group: string, node: string): Promise<void> => {
        world.calls.push(`change:${group}:${node}`)
        world.group.fixed = node
      },
      mihomoUnfixedProxy: async (group: string): Promise<void> => {
        world.calls.push(`unfix:${group}`)
        world.group.fixed = undefined
      },
      mihomoCloseConnections: async (name: string, via?: string): Promise<void> => {
        world.calls.push(`close:${via}:${name}`)
        if (world.closeError) {
          throw world.closeError
        }
      },
      mihomoProxyProviders: async (): Promise<unknown> => {
        if (world.providersError !== undefined) {
          throw world.providersError
        }
        return {
          providers: world.fastProviderListed
            ? { [FAST_NODE_PROVIDER_ID]: { proxies: world.leaves } }
            : {}
        }
      },
      mihomoProviderLeafDelay: async (
        provider: string,
        node: string,
        url: string
      ): Promise<{ delay: number }> => {
        world.calls.push(`delay:${provider}:${node}:${url}`)
        const result = world.delayOf(node)
        if (result instanceof Error) {
          throw result
        }
        return { delay: result }
      }
    }
  })
  mock.module('./sparkleGeminiProbe', {
    exports: {
      verifyNodeGeminiRegion: async (node: string): Promise<RegionVerdict> => {
        world.calls.push(`region:${node}`)
        return world.regionOf(node)
      },
      rebuildAndReloadSparkleFastProvider: async (): Promise<void> => {
        world.calls.push('rebuild')
      }
    }
  })
  mock.module('./sparkleThroughputProbe', {
    exports: {
      GOOGLE_TARGET,
      CONTROL_TARGET,
      measureNodeThroughput: async (
        node: string,
        target: typeof GOOGLE_TARGET
      ): Promise<ThroughputReading> => {
        const role: ProbeRole = target === GOOGLE_TARGET ? 'primary' : 'control'
        world.calls.push(`measure:${role}:${node}`)
        await world.onMeasure?.(node, role)
        return world.readingOf(node, role)
      }
    }
  })
  mock.module('./sparkleNodeQualityCache', {
    exports: {
      loadSunkNodeNames: async (): Promise<ReadonlySet<string>> => new Set(world.sunk),
      markNodesSunk: async (names: readonly string[]): Promise<void> => {
        if (names.length === 0) {
          return
        }
        world.calls.push(`sink:${names.join(',')}`)
        for (const name of names) {
          world.sunk.add(name)
        }
      }
    }
  })
  if (guard === 'stub') {
    installGuardStub()
  }
}

export interface StickyPinHandle {
  start: () => void
  /** 让轮询把 `now`（A）经准入钉住，之后的调用与日志记录从零开始。 */
  pinA: (leaves?: Leaf[]) => Promise<void>
  notifyUnfixed: (group: string) => void
  /** 仅 `guard: 'real'`：本用例加载的质量闸门，与固定逻辑共用同一份状态。 */
  guard: typeof QualityGuard
}

export interface StickyPinRigOptions {
  guard?: 'stub' | 'real'
}

/** 在当前 describe 内注册钩子：替身、假时钟、每个用例一份全新加载的被测模块。 */
export function useStickyPinRig(options: StickyPinRigOptions = {}): StickyPinHandle {
  const guardMode = options.guard ?? 'stub'
  let sticky: typeof StickyPin
  let guard: typeof QualityGuard

  before(() => installMocks(guardMode))
  beforeEach(() => {
    resetWorld()
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_700_000_000_000 })
    delete require.cache[require.resolve('./autoSelectStickyPin')]
    if (guardMode === 'real') {
      // 闸门带着模块级状态，必须和固定逻辑一起重新加载，否则用例之间会串状态
      delete require.cache[require.resolve('./autoSelectQualityGuard')]
      guard = require('./autoSelectQualityGuard') as typeof QualityGuard
    }
    sticky = require('./autoSelectStickyPin') as typeof StickyPin
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return {
    start: () => sticky.startAutoSelectStickyPin(),
    pinA: async (leaves = [aliveLeaf('A'), aliveLeaf('B')]) => {
      world.leaves = leaves
      sticky.startAutoSelectStickyPin()
      await poll(2)
      assert.deepEqual(changes(), ['A'])
      world.calls = []
      world.logs = []
    },
    notifyUnfixed: (group) => sticky.notifyAutoSelectUnfixed(group),
    get guard() {
      return guard
    }
  }
}
