// [INPUT] node:test 假时钟与模块替身 · autoSelectStickyPin（被测模块，每个用例重新加载） ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成)
// [OUTPUT] useStickyPinRig · world · poll/jump/settle · 断言辅助（callsStarting/changes/unfixes）· DELAY_ALIVE/DELAY_DEAD · ELIGIBLE/restricted
// [POS] autoSelectStickyPin 行为测试夹具：用可脚本化的 mihomo 控制器与地区校验替身，
// 在假时钟上驱动 3 秒轮询。仅供测试使用。

import { afterEach, before, beforeEach, mock } from 'node:test'
import { AUTO_SELECT_DELAY_PROBE_URL } from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
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

interface Leaf {
  name: string
  extra?: Record<string, { alive: boolean }>
}

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

export const world = {
  group: { type: 'Fallback', now: 'A', all: ['A', 'B'] } as GroupSnapshot,
  leaves: [] as Leaf[],
  delayOf: (_node: string): number | Error => 120,
  regionOf: (_node: string): RegionVerdict => ELIGIBLE,
  detailError: undefined as Error | undefined,
  onDetail: undefined as undefined | ((call: number) => void | Promise<void>),
  detailCalls: 0,
  calls: [] as string[],
  logs: [] as string[]
}

function resetWorld(): void {
  world.group = { type: 'Fallback', now: 'A', all: ['A', 'B'] }
  world.leaves = []
  world.delayOf = () => 120
  world.regionOf = () => ELIGIBLE
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

function installMocks(): void {
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
      mihomoProxyProviders: async (): Promise<unknown> => ({
        providers: { [FAST_NODE_PROVIDER_ID]: { proxies: world.leaves } }
      }),
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
      }
    }
  })
}

export interface StickyPinHandle {
  start: () => void
  notifyUnfixed: (group: string) => void
}

/** 在当前 describe 内注册钩子：替身、假时钟、每个用例一份全新加载的被测模块。 */
export function useStickyPinRig(): StickyPinHandle {
  let sticky: typeof StickyPin

  before(installMocks)
  beforeEach(() => {
    resetWorld()
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_700_000_000_000 })
    delete require.cache[require.resolve('./autoSelectStickyPin')]
    sticky = require('./autoSelectStickyPin') as typeof StickyPin
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return {
    start: () => sticky.startAutoSelectStickyPin(),
    notifyUnfixed: (group) => sticky.notifyAutoSelectUnfixed(group)
  }
}
