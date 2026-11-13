// [INPUT] node:test 假时钟与模块替身 · sparkleGeminiProbe（被测模块，每个用例重新加载）· 临时目录里的真实缓存与 provider 文件 ·
//         defaultAutoSwitchProxy::AUTO_SELECT_GEMINI_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_FILENAME/FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具) ·
//         utils/yaml::parseYaml (POS: YAML 解析与序列化)
// [OUTPUT] useGeminiRig · world · NODES · samplesFor · cacheRecord/cacheKey · 文件读写辅助 · 断言辅助
// [POS] sparkleGeminiProbe 行为测试夹具：配置、mihomo 控制器、流式探测与日志用替身，
// 地区缓存与 sparkle-fast 文件走临时目录里的真实文件。仅供测试使用。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import { AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { FAST_NODE_PROVIDER_FILENAME, FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { mockFsPromisesSync } from './syncFsPromisesRig'
import type * as GeminiProbe from './sparkleGeminiProbe'

export const NOW = 1_700_000_000_000
export const HOUR_MS = 60 * 60 * 1000
export const AUDIT_INTERVAL_MS = 30 * 60 * 1000
const CACHE_FILENAME = 'sparkle-gemini-nodes.json'

export type Proxy = Record<string, unknown>

export const NODES: Proxy[] = [
  { name: '台湾-1', type: 'ss', server: 'tw1.example.com', port: 443 },
  { name: '台湾-2', type: 'ss', server: 'tw2.example.com', port: 443 },
  { name: '日本-1', type: 'ss', server: 'jp1.example.com', port: 443 }
]

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
      geminiAlive === undefined ? {} : { [AUTO_SELECT_GEMINI_PROBE_URL]: { alive: geminiAlive } }
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
  providersFailure: undefined as undefined | { reason: unknown },
  pinned: undefined as string | undefined,
  updateFailure: undefined as undefined | { reason: unknown },
  delaySnapshot: new Map<string, number>(),
  calls: [] as string[],
  logs: [] as string[]
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
  world.providersFailure = undefined
  world.pinned = undefined
  world.updateFailure = undefined
  world.delaySnapshot = new Map()
  world.calls = []
  world.logs = []
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

/** 整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 data/profiles 子目录。 */
const root = mkdtempSync(path.join(tmpdir(), 'sparkle-gemini-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

const dirs = { data: path.join(root, 'data'), profiles: path.join(root, 'profiles') }

const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, FAST_NODE_PROVIDER_FILENAME)

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

export function writeCache(records: Record<string, unknown>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function writeCacheRaw(text: string): void {
  writeFileSync(cacheFile(), text, 'utf8')
}

export function readCache(): Record<string, { eligible: boolean; countryCode: string }> {
  return JSON.parse(readFileSync(cacheFile(), 'utf8'))
}

export function cacheFileExists(): boolean {
  try {
    readFileSync(cacheFile())
    return true
  } catch {
    return false
  }
}

export function readProviderOrder(): string[] | undefined {
  try {
    const { proxies = [] } = parseYaml<{ proxies?: Proxy[] }>(readFileSync(providerFile(), 'utf8'))
    return proxies.map((proxy) => String(proxy.name))
  } catch {
    return undefined
  }
}

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
  mock.module('./sparkleMailPortProbe', {
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
  mock.module('./mihomoApi', {
    exports: {
      mihomoProxyProviders: async (): Promise<unknown> => {
        if (world.providersFailure) {
          throw world.providersFailure.reason
        }
        return { providers: { [FAST_NODE_PROVIDER_ID]: { proxies: world.leaves } } }
      },
      mihomoGroupDetail: async (name: string): Promise<{ fixed?: string }> => {
        world.calls.push(`detail:${name}`)
        return { fixed: world.pinned }
      },
      mihomoUnfixedProxy: async (name: string): Promise<void> => {
        world.calls.push(`unfix:${name}`)
      },
      mihomoUpdateProxyProviders: async (name: string): Promise<void> => {
        world.calls.push(`update:${name}`)
        if (world.updateFailure) {
          throw world.updateFailure.reason
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
    rmSync(dirs.data, { recursive: true, force: true })
    rmSync(dirs.profiles, { recursive: true, force: true })
    mkdirSync(dirs.data, { recursive: true })
    mkdirSync(dirs.profiles, { recursive: true })
    mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW })
    delete require.cache[require.resolve('./sparkleGeminiProbe')]
    probe = require('./sparkleGeminiProbe') as typeof GeminiProbe
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return () => probe
}
