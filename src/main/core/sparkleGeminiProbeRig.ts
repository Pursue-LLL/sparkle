// [INPUT] node:test 假时钟与模块替身 · sparkleGeminiProbe/sparkleGeminiProviderSync/sparkleGeminiRegionCache/sparkleGeminiStabilityStore/sparkleGeminiCurrentNodeGuard（被测模块，每个用例重新加载）·
//         cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         sparkleGeminiFilesHarness::dirs/resetDirs (POS: Gemini 行为测试夹具的临时目录与文件读写) ·
//         sparkleGeminiProviderCore::GEMINI_NODE_PROVIDER_ID (POS: gemini provider 与分组配置) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具)
// [OUTPUT] useGeminiRig · regionCache · providerSync · guard · world · NODES · manyNodes · leaf · UNUSABLE_PROFILES · cacheRecord/cacheKey · 断言辅助
// [POS] Gemini 探测、provider 对账、判定存储与队首守护的行为测试夹具：配置、mihomo 控制器、流式探测与日志用替身，
// 缓存、台账与 provider 文件走 sparkleGeminiFilesHarness 管的临时目录里的真实文件。仅供测试使用。

import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, mock } from 'node:test'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_DELAY_PROBE_URL } from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { dirs, resetDirs } from './sparkleGeminiFilesHarness'
import { GEMINI_NODE_PROVIDER_ID } from './sparkleGeminiProviderCore'
import { mockFsPromisesSync } from './syncFsPromisesRig'
import type * as GeminiGuard from './sparkleGeminiCurrentNodeGuard'
import type * as GeminiProbe from './sparkleGeminiProbe'
import type * as GeminiProviderSync from './sparkleGeminiProviderSync'
import type * as GeminiRegionCache from './sparkleGeminiRegionCache'

export const NOW = 1_700_000_000_000
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const AUDIT_INTERVAL_MS = 30 * 60 * 1000
/** 合格记录到这个年龄就会被审计复验：留出两个审计周期外加 5 分钟余量。 */
export const REFRESH_AFTER_MS = 12 * HOUR_MS - 2 * AUDIT_INTERVAL_MS - 5 * 60 * 1000

export type Proxy = Record<string, unknown>

export const NODES: Proxy[] = [
  { name: '台湾-1', type: 'ss', server: 'tw1.example.com', port: 443 },
  { name: '台湾-2', type: 'ss', server: 'tw2.example.com', port: 443 },
  { name: '日本-1', type: 'ss', server: 'jp1.example.com', port: 443 }
]

/** 名字形如 `节点-01`、互不相同的一批节点。 */
export function manyNodes(count: number): Proxy[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `节点-${String(index + 1).padStart(2, '0')}`,
    type: 'ss',
    server: `s${index}.example.com`,
    port: 443
  }))
}

export const cacheKey = (proxy: Proxy): string => computeProxyNodeFingerprint(proxy)

export function cacheRecord(
  eligible: boolean,
  countryCode = eligible ? 'TW' : 'ZZ',
  ageMs = 0
): { eligible: boolean; countryCode: string; checkedAt: number } {
  return { eligible, countryCode, checkedAt: NOW - ageMs }
}

/** mihomo 在 provider 接口里给出的节点；geminiAlive 缺省表示没有 Gemini 探测记录。 */
export function leaf(name: string, alive: boolean, geminiAlive?: boolean): Proxy {
  return {
    name,
    alive,
    extra:
      geminiAlive === undefined ? {} : { [AUTO_SELECT_DELAY_PROBE_URL]: { alive: geminiAlive } }
  }
}

export interface ProbeVerdict {
  definitive: boolean
  eligible: boolean
  countryCode?: string
}

export const world = {
  profile: { current: 'p1' } as { current?: string },
  profileError: false,
  profileReads: 0,
  profileProxies: NODES as Proxy[],
  appConfig: {} as { proxySwitchPriority?: string[] },
  verdictOf: (_node: string): ProbeVerdict => ({ definitive: false, eligible: true }),
  probeFailure: undefined as undefined | { reason: unknown },
  onProbe: undefined as undefined | ((node: string) => Promise<void> | void),
  probedNode: '',
  leaves: [] as Proxy[],
  /** mihomo 此刻在 gemini专用 provider 里服务的节点名；undefined 表示 provider 还没进入运行配置。 */
  geminiProvider: undefined as string[] | undefined,
  providersFailure: undefined as undefined | { reason: unknown },
  onProvidersRead: undefined as undefined | (() => Promise<void> | void),
  /** gemini专用 组此刻的队首（`now`）与成员。 */
  geminiGroup: { now: undefined as string | undefined, all: [] as string[] },
  groupFailure: undefined as undefined | { reason: unknown },
  /** mihomo 此刻的活动连接（只含守护会读的链路）；undefined 表示没有任何连接。 */
  connections: undefined as { connections: Array<{ chains: string[] }> } | undefined,
  connectionsFailure: false,
  /** 守护订阅内核日志后留下的处理函数，以及订阅了几次。 */
  logHandler: undefined as undefined | ((log: ControllerLog) => void),
  subscriptions: 0,
  pinned: undefined as string | undefined,
  updateFailure: undefined as undefined | { reason: unknown },
  /** provider 热重载成功之后的回调：用来让测试里的 mihomo 状态跟着新文件走。 */
  onProviderUpdate: undefined as undefined | ((name: string) => void),
  closeFailure: undefined as undefined | { reason: unknown },
  delaySnapshot: new Map<string, number>(),
  sunk: new Set<string>(),
  calls: [] as string[],
  logs: [] as string[],
  /** 日志写入失败：连失败路径上的日志也写不出。 */
  logFails: false
}

function resetWorld(): void {
  world.profile = { current: 'p1' }
  world.profileError = false
  world.profileReads = 0
  world.profileProxies = NODES
  world.appConfig = {}
  world.verdictOf = () => ({ definitive: false, eligible: true })
  world.probeFailure = undefined
  world.onProbe = undefined
  world.probedNode = ''
  world.leaves = []
  world.geminiProvider = undefined
  world.providersFailure = undefined
  world.onProvidersRead = undefined
  world.geminiGroup = { now: undefined, all: [] }
  world.groupFailure = undefined
  world.connections = undefined
  world.connectionsFailure = false
  world.logHandler = undefined
  world.subscriptions = 0
  world.pinned = undefined
  world.updateFailure = undefined
  world.onProviderUpdate = undefined
  world.closeFailure = undefined
  world.delaySnapshot = new Map()
  world.sunk = new Set()
  world.calls = []
  world.logs = []
  world.logFails = false
}

/** 读不到当前订阅节点的几种情形：配置读取失败、选中默认配置、没有选中订阅。 */
export const UNUSABLE_PROFILES: ReadonlyArray<readonly [label: string, apply: () => void]> = [
  [
    'config cannot be read',
    () => {
      world.profileError = true
    }
  ],
  [
    'selected one is the default',
    () => {
      world.profile = { current: 'default' }
    }
  ],
  [
    'selected one is missing',
    () => {
      world.profile = {}
    }
  ]
]

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await flush()
  }
}

export async function tickAudit(): Promise<void> {
  mock.timers.tick(AUDIT_INTERVAL_MS)
  await settle()
}

export function assertLog(fragment: string): void {
  assert.ok(
    world.logs.some((line) => line.includes(fragment)),
    `missing log "${fragment}" in:\n${world.logs.join('')}`
  )
}

export function assertNoLog(fragment: string): void {
  assert.ok(
    !world.logs.some((line) => line.includes(fragment)),
    `unexpected log "${fragment}" in:\n${world.logs.join('')}`
  )
}

let currentProbe: typeof GeminiProbe
let currentRegionCache: typeof GeminiRegionCache
let currentProviderSync: typeof GeminiProviderSync

/** 当前用例重新加载的地区缓存模块。 */
export const regionCache = (): typeof GeminiRegionCache => currentRegionCache

/** 当前用例重新加载的 gemini provider 对账模块。 */
export const providerSync = (): typeof GeminiProviderSync => currentProviderSync

/** 当前用例的队首守护：首次调用时才加载，且一定晚于本用例重新加载的探测与对账模块，所以和它们共用同一份实例。 */
export const guard = (): typeof GeminiGuard =>
  require('./sparkleGeminiCurrentNodeGuard') as typeof GeminiGuard

/** 持有模块级状态（内存缓存、台账、在途标记、定时器）的模块：每个用例都要重新加载，且要整条链一起换。 */
const STATEFUL_MODULES = [
  './sparkleGeminiProbe',
  './sparkleGeminiProviderSync',
  './sparkleGeminiRegionCache',
  './sparkleGeminiStabilityStore',
  './sparkleGeminiCurrentNodeGuard'
] as const

let mocksInstalled = false

/** node:test 对同一个模块只允许替换一次，所以多处调用 useGeminiRig 时只装一次。 */
function installMocks(): void {
  if (mocksInstalled) {
    return
  }
  mocksInstalled = true
  mockFsPromisesSync()
  mock.module('../utils/dirs', {
    exports: { dataDir: () => dirs.data, profilesDir: () => dirs.profiles }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        if (world.logFails) {
          throw new Error('disk full')
        }
        world.logs.push(line)
      }
    }
  })
  mock.module('../config', {
    exports: {
      getAppConfig: async () => world.appConfig,
      getProfileConfig: async () => {
        world.profileReads += 1
        if (world.profileError) {
          throw new Error('profile config unreadable')
        }
        return world.profile
      },
      getProfile: async () => ({ proxies: world.profileProxies })
    }
  })
  mock.module('./provider', {
    exports: { extractProxies: (profile: { proxies: Proxy[] }): Proxy[] => profile.proxies }
  })
  mock.module('./localProbeChannel', {
    exports: {
      withLocalProbeChannelLock: async <T>(node: string, run: () => Promise<T>): Promise<T> => {
        world.calls.push(`lock:${node}`)
        world.probedNode = node
        await world.onProbe?.(node)
        return run()
      }
    }
  })
  mock.module('./sparkleGeminiStreamProbe', {
    exports: {
      streamProbeGeminiRegionViaLocalListener: async (): Promise<ProbeVerdict> => {
        if (world.probeFailure) {
          throw world.probeFailure.reason
        }
        return world.verdictOf(world.probedNode)
      }
    }
  })
  mock.module('./sparkleFastLatencyOrder', {
    exports: { loadSparkleFastDelaySnapshot: async () => world.delaySnapshot }
  })
  // 真实的加载器会动态引入被测模块，拿到的是 ESM 缓存里的第一份实例，而不是本用例刚重新加载的那份。
  mock.module('./sparkleFastProviderExclusions', {
    exports: {
      loadFastProviderExclusions: async (proxies: readonly Proxy[]) => ({
        blockedNodeNames: await currentProbe.loadGeminiBlockedNodeNames(proxies),
        sunkNodeNames: world.sunk
      })
    }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoProxyProviders: async (): Promise<unknown> => {
        await world.onProvidersRead?.()
        if (world.providersFailure) {
          throw world.providersFailure.reason
        }
        return {
          providers: {
            [FAST_NODE_PROVIDER_ID]: { proxies: world.leaves },
            ...(world.geminiProvider && {
              [GEMINI_NODE_PROVIDER_ID]: {
                proxies: world.geminiProvider.map((name) => ({ name }))
              }
            })
          }
        }
      },
      mihomoGroupDetail: async (
        name: string
      ): Promise<{ fixed?: string } | typeof world.geminiGroup> => {
        world.calls.push(`detail:${name}`)
        if (name !== GEMINI_DEDICATED_GROUP_NAME) {
          return { fixed: world.pinned }
        }
        if (world.groupFailure) {
          throw world.groupFailure.reason
        }
        return world.geminiGroup
      },
      mihomoGetConnections: async (): Promise<typeof world.connections> => {
        if (world.connectionsFailure) {
          throw new Error('connections unavailable')
        }
        return world.connections
      },
      subscribeMihomoLogs: (handler: (log: ControllerLog) => void): void => {
        world.subscriptions += 1
        world.logHandler = handler
      },
      mihomoUnfixedProxy: async (name: string): Promise<void> => {
        world.calls.push(`unfix:${name}`)
      },
      mihomoUpdateProxyProviders: async (name: string): Promise<void> => {
        world.calls.push(`update:${name}`)
        if (world.updateFailure) {
          throw world.updateFailure.reason
        }
        world.onProviderUpdate?.(name)
      },
      mihomoCloseConnections: async (node: string, group: string): Promise<void> => {
        world.calls.push(`close:${node}:${group}`)
        if (world.closeFailure) {
          throw world.closeFailure.reason
        }
      }
    }
  })
}

export function useGeminiRig(): () => typeof GeminiProbe {
  let probe: typeof GeminiProbe

  before(installMocks)
  beforeEach(() => {
    resetWorld()
    resetDirs()
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW })
    for (const specifier of STATEFUL_MODULES) {
      delete require.cache[require.resolve(specifier)]
    }
    probe = require('./sparkleGeminiProbe') as typeof GeminiProbe
    currentProbe = probe
    currentRegionCache = require('./sparkleGeminiRegionCache') as typeof GeminiRegionCache
    currentProviderSync = require('./sparkleGeminiProviderSync') as typeof GeminiProviderSync
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return () => probe
}
