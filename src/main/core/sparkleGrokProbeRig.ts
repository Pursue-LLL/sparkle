// [INPUT] node:test 假时钟与模块替身 · sparkleGrokProbe 及其子模块（被测，每个用例重新加载）· 临时目录里的真实数据 / provider 文件 · 假的 axios · sparkleGrokProbeWorld ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         sparkleGrokProbeCache (POS: grok 探测缓存) ·
//         sparkleGrokProbeSnapshot (POS: grok 展示快照) ·
//         sparkleGrokProviderCore::GROK_NODE_PROVIDER_FILENAME/GrokProbeSnapshot (POS: grok provider 与快照) ·
//         sparkleGrokRoutedCheck (POS: grok 真实请求判定口径) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具) ·
//         timerSpyHarness::spyOnTimer/TimerSpy (POS: 定时器记录夹具) ·
//         utils/yaml::parseYaml/stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] useGrokRig · snapshot/loadCache/routedCheck · 文件读写辅助 · runBootstrap/settle/advance/setNow · 重导出 sparkleGrokProbeWorld 的全部夹具
// [POS] sparkleGrokProbe 行为测试夹具：配置、mihomo 控制器与日志用替身，grok.com 请求用可编排结局的假 axios，
// 探测缓存与 provider 文件走临时目录里的真实文件。仅供测试使用。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { flush } from './groupFailoverEngineHarness'
import type * as GrokProbe from './sparkleGrokProbe'
import type * as GrokCache from './sparkleGrokProbeCache'
import type * as GrokSnapshot from './sparkleGrokProbeSnapshot'
import type * as GrokRoutedCheck from './sparkleGrokRoutedCheck'
import {
  JP1,
  NOW,
  TW1,
  US1,
  cacheKey,
  cacheRecord,
  resetWorld,
  world,
  type CacheRecord,
  type Proxy,
  type Routed
} from './sparkleGrokProbeWorld'
import { GROK_NODE_PROVIDER_FILENAME, type GrokProbeSnapshot } from './sparkleGrokProviderCore'
import { mockFsPromisesSync } from './syncFsPromisesRig'
import { spyOnTimer, type TimerSpy } from './timerSpyHarness'

export * from './sparkleGrokProbeWorld'

const CACHE_FILENAME = 'sparkle-grok-nodes.json'

/** 整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 data/profiles。 */
const root = mkdtempSync(path.join(tmpdir(), 'sparkle-grok-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

const dirs = {
  data: path.join(root, 'data'),
  profiles: path.join(root, 'profiles')
}

const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, GROK_NODE_PROVIDER_FILENAME)

export function writeCache(records: Record<string, CacheRecord>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function writeCacheRaw(text: string): void {
  writeFileSync(cacheFile(), text, 'utf8')
}

export function readCache(): Record<string, CacheRecord> {
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

export function writeProviderMembers(names: string[]): void {
  const proxies = names.map((name) => ({
    name,
    type: 'ss',
    server: `${name}.example.com`,
    port: 1
  }))
  writeFileSync(providerFile(), stringifyYaml({ proxies }), 'utf8')
}

export function readProviderMembers(): string[] | undefined {
  try {
    const { proxies = [] } = parseYaml<{ proxies?: Proxy[] }>(readFileSync(providerFile(), 'utf8'))
    return proxies.map((proxy) => String(proxy.name))
  } catch {
    return undefined
  }
}

/**
 * 稳态起点：缓存里有 3 个已验证节点，provider 文件与 mihomo 组成员一致，组里选中最快的日本-1。
 * 节点 RTT：日本-1 120 / 美国-1 200 / 台湾-1 300。
 */
export function seedHealthyPool(): void {
  const names = ['日本-1', '美国-1', '台湾-1']
  writeCache({
    [cacheKey(JP1)]: cacheRecord(true, 120),
    [cacheKey(US1)]: cacheRecord(true, 200),
    [cacheKey(TW1)]: cacheRecord(true, 300)
  })
  writeProviderMembers(names)
  world.members = names
  world.selection = '日本-1'
}

/** 让「每 5 分钟刷新池内延迟」这一步失败且不耗时：场景不关心它时用，避免它改写缓存、推进时钟。 */
export function skipPoolRefresh(): void {
  world.groupDelayFailure = { reason: new Error('pool refresh disabled by test') }
  world.groupDelayTakesMs = 0
}

/** 假时钟向前走 ms 毫秒（会触发到点的定时器）。 */
export const advance = (ms: number): void => mock.timers.tick(ms)

/** 把假时钟直接拨到绝对时间；不触发定时器，用来精确停在某个边界上。 */
export const setNow = (ms: number): void => mock.timers.setTime(ms)

export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await flush()
  }
}

/** 本用例里登记过的 setTimeout；驱动据此推进「复核前等 1 秒」这类等待。 */
let waits: TimerSpy

/** 跑完一轮 bootstrap；途中被被测代码挂起的定时等待由这里推进时钟。 */
export async function runBootstrap(grok: typeof GrokProbe): Promise<void> {
  const state = { finished: false }
  const run = grok.bootstrapSparkleGrokProvider().finally(() => {
    state.finished = true
  })
  let handled = 0
  for (let guard = 0; guard < 500 && !state.finished; guard++) {
    await settle()
    while (!state.finished && handled < waits.delays.length) {
      mock.timers.tick(waits.delays[handled])
      handled += 1
    }
  }
  await run
}

function pickRouted(): Routed {
  const selected = world.selection ?? ''
  return world.routedQueue.shift() ?? world.routedByNode[selected] ?? world.defaultRouted
}

async function fakeRequest(
  config: Record<string, unknown>
): Promise<{ status: number; headers: Record<string, string> }> {
  world.requests.push({ via: world.selection ?? '', config })
  const routed = pickRouted()
  if (routed.kind === 'hang') {
    // 永不兑现：模拟 mihomo / 网络无响应导致一轮探测卡死。
    return new Promise<never>(() => {
      /* never settles */
    })
  }
  mock.timers.tick(routed.rttMs ?? 5)
  if (routed.kind === 'failure') {
    throw routed.error
  }
  return {
    status: routed.status,
    headers: routed.cfMitigated ? { 'cf-mitigated': routed.cfMitigated } : {}
  }
}

let mocksInstalled = false

/** node:test 对同一个模块只允许替换一次，所以多处调用 useGrokRig 时只装一次。 */
function installMocks(): void {
  if (mocksInstalled) {
    return
  }
  mocksInstalled = true
  mockFsPromisesSync()
  mock.module(require.resolve('axios'), { exports: { default: { request: fakeRequest } } })
  mock.module('../utils/dirs', {
    exports: { dataDir: () => dirs.data, profilesDir: () => dirs.profiles }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        if (world.logFailure) {
          throw new Error('log file is not writable')
        }
        world.logs.push(line)
      }
    }
  })
  mock.module('../config', {
    exports: {
      getControledMihomoConfig: async (): Promise<Record<string, unknown>> => {
        if (world.controlledFailure) {
          throw new Error('controlled config unreadable')
        }
        return world.controlled
      },
      getProfileConfig: async () => {
        world.profileReads += 1
        if (world.profileFailure) {
          throw world.profileFailure.reason
        }
        return world.profile
      },
      getProfile: async () => ({ proxies: world.profileProxies })
    }
  })
  mock.module('./provider', {
    exports: { extractProxies: (profile: { proxies: Proxy[] }): Proxy[] => profile.proxies }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoGroupDetail: async (group: string): Promise<{ now?: string; all: string[] }> => {
        world.calls.push(`detail:${group}`)
        if (world.groupMissing) {
          throw new Error('Resource not found')
        }
        return { now: world.selection, all: [...world.members] }
      },
      mihomoChangeProxy: async (_group: string, node: string): Promise<boolean> => {
        world.calls.push(`change:${node}`)
        if (world.changeFailure) {
          throw new Error('mihomo api unreachable')
        }
        if (world.changeRefused.has(node) || !world.members.includes(node)) {
          return false
        }
        world.selection = node
        return true
      },
      mihomoCloseConnections: async (group: string): Promise<void> => {
        world.calls.push(`close:${group}`)
        if (world.closeFailure) {
          throw new Error('close failed')
        }
      },
      mihomoUpdateProxyProviders: async (id: string): Promise<void> => {
        world.calls.push(`update:${id}`)
        if (world.updateFailure) {
          throw world.updateFailure.reason
        }
        // mihomo 重读 provider 文件后，组成员随之改变；选中的节点没了就落到第一个成员。
        world.members = readProviderMembers() ?? []
        if (world.selection && !world.members.includes(world.selection)) {
          world.selection = world.members[0]
        }
      },
      mihomoGroupDelay: async (
        group: string,
        url: string,
        options: unknown
      ): Promise<Record<string, number>> => {
        world.calls.push(`delay:${group}`)
        world.groupDelayCalls.push({ group, url, options })
        mock.timers.tick(world.groupDelayTakesMs)
        if (world.groupDelayFailure) {
          throw world.groupDelayFailure.reason
        }
        return world.groupDelays
      }
    }
  })
}

/** 每个用例都要从零开始：探针的几个模块各自带着内存状态。 */
const GROK_MODULES = [
  './sparkleGrokProbe',
  './sparkleGrokProbeSnapshot',
  './sparkleGrokProbeCache',
  './sparkleGrokProviderSync',
  './sparkleGrokGroupControl',
  './sparkleGrokRoutedCheck'
] as const

/** 本用例里探针当前的展示快照。 */
export function snapshot(): GrokProbeSnapshot {
  return (
    require('./sparkleGrokProbeSnapshot') as typeof GrokSnapshot
  ).getSparkleGrokProbeSnapshot()
}

/** 本用例里的真实请求模块（探针的最底层，可直接驱动）。 */
export function routedCheck(): typeof GrokRoutedCheck {
  return require('./sparkleGrokRoutedCheck') as typeof GrokRoutedCheck
}

/** 经本用例里的缓存模块读磁盘上的探测缓存。 */
export function loadCache(): ReturnType<typeof GrokCache.loadSparkleGrokProbeCache> {
  return (require('./sparkleGrokProbeCache') as typeof GrokCache).loadSparkleGrokProbeCache()
}

export function useGrokRig(): () => typeof GrokProbe {
  let probe: typeof GrokProbe

  before(installMocks)
  beforeEach(() => {
    resetWorld()
    for (const dir of Object.values(dirs)) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    }
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW })
    waits = spyOnTimer('setTimeout')
    for (const module of GROK_MODULES) {
      delete require.cache[require.resolve(module)]
    }
    probe = require('./sparkleGrokProbe') as typeof GrokProbe
  })
  afterEach(() => {
    waits.restore()
    mock.timers.reset()
  })

  return () => probe
}
