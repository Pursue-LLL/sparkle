// [INPUT] node:test 假时钟与模块替身 · sparkleAgyProbe 及其子模块（被测，每个用例重新加载）· 临时目录里的真实 HOME / 数据目录 / provider 文件 · 假的 agy CLI 进程 · sparkleAgyProbeWorld ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         sparkleAgyCli (POS: 官方 agy CLI 请求) ·
//         sparkleAgyGroupControl (POS: agy 组操作) ·
//         sparkleAgyProbeSnapshot (POS: agy 展示快照) ·
//         sparkleAgyProviderCore::AGY_NODE_PROVIDER_FILENAME (POS: agy provider 与分组配置) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具) ·
//         utils/yaml::parseYaml (POS: YAML 解析与序列化)
// [OUTPUT] useAgyRig · snapshot/syncSnapshot/groupControl/agyCli · 文件读写辅助 · runBootstrap/drive/expireHangingProbe/settle · 重导出 sparkleAgyProbeWorld 的全部夹具
// [POS] sparkleAgyProbe 行为测试夹具：配置、mihomo 控制器与日志用替身，agy CLI 用可编排结局的假子进程，
// 探测缓存、provider 文件与探测目录走临时目录里的真实文件。仅供测试使用。

import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import { flush } from './groupFailoverEngineHarness'
import type * as AgyCli from './sparkleAgyCli'
import type * as AgyProbe from './sparkleAgyProbe'
import type * as AgyGroupControl from './sparkleAgyGroupControl'
import type * as AgySnapshot from './sparkleAgyProbeSnapshot'
import { NOW, resetWorld, world, type CliOutcome, type Proxy } from './sparkleAgyProbeWorld'
import { AGY_NODE_PROVIDER_FILENAME } from './sparkleAgyProviderCore'
import { mockFsPromisesSync } from './syncFsPromisesRig'

export * from './sparkleAgyProbeWorld'

const CACHE_FILENAME = 'sparkle-agy-nodes.json'

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  kill(signal: string): boolean {
    world.killed.push(signal)
    if (world.killFailure) {
      throw new Error('process already exited')
    }
    return true
  }
}

/** 整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 home/data/profiles。 */
const root = mkdtempSync(path.join(tmpdir(), 'sparkle-agy-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

const dirs = {
  home: path.join(root, 'home'),
  data: path.join(root, 'data'),
  profiles: path.join(root, 'profiles')
}

export const homeDir = (): string => dirs.home
export const probeDir = (): string => path.join(dirs.data, 'agy-probe')
export const probeCliDir = (): string => path.join(probeDir(), 'antigravity-cli')
const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, AGY_NODE_PROVIDER_FILENAME)

export function writeCache(records: Record<string, unknown>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function readCache(): Record<string, { usable: boolean; rttMs: number; checkedAt: number }> {
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

export function readProviderMembers(): string[] | undefined {
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

/** 悬挂的假进程到点会被探测超时杀掉：推进时钟到它的超时点；没有悬挂的进程时返回 false。 */
export function expireHangingProbe(): boolean {
  const wait = world.hangingTimeoutMs
  if (wait === undefined) {
    return false
  }
  world.hangingTimeoutMs = undefined
  world.perfNowMs += wait
  mock.timers.tick(wait)
  return true
}

/** 等一个异步操作做完；途中悬挂的假进程由这里推进时钟让探测超时。 */
export async function drive<T>(operation: Promise<T>): Promise<T> {
  const state = { finished: false }
  const run = operation.finally(() => {
    state.finished = true
  })
  for (let guard = 0; guard < 500 && !state.finished; guard++) {
    await settle()
    if (!state.finished) {
      expireHangingProbe()
    }
  }
  return run
}

/** 跑完一轮 bootstrap。 */
export function runBootstrap(agy: typeof AgyProbe): Promise<void> {
  return drive(agy.bootstrapSparkleAgyProvider())
}

function emitOutcome(child: FakeChild, outcome: CliOutcome, args: string[]): void {
  queueMicrotask(() => {
    if (outcome.kind !== 'hang') {
      world.perfNowMs += outcome.rttMs ?? 1
    }
    switch (outcome.kind) {
      case 'ok':
        child.stdout.emit('data', Buffer.from('OK\n'))
        child.emit('close', 0)
        break
      case 'location':
        child.stderr.emit(
          'data',
          Buffer.from('Error 400: User location is not supported for the API use.')
        )
        child.emit('close', 1)
        break
      case 'error':
        child.emit('error', new Error('spawn agy ENOENT'))
        break
      case 'chunks':
        for (const chunk of outcome.chunks) {
          ;(chunk.stream === 'stdout' ? child.stdout : child.stderr).emit(
            'data',
            Buffer.from(chunk.text)
          )
        }
        child.emit('close', outcome.code)
        break
      case 'hang': {
        const printTimeoutSec = Number.parseInt(args[args.indexOf('--print-timeout') + 1], 10)
        world.hangingTimeoutMs = (printTimeoutSec + 5) * 1000
        break
      }
      case 'throw':
        break
    }
  })
}

function nextOutcome(selected: string): CliOutcome {
  return world.outcomes.shift() ?? world.outcomeByNode[selected] ?? world.defaultOutcome
}

let mocksInstalled = false

/** node:test 对同一个模块只允许替换一次，所以多处调用 useAgyRig 时只装一次。 */
function installMocks(): void {
  if (mocksInstalled) {
    return
  }
  mocksInstalled = true
  mockFsPromisesSync()
  mock.module('node:child_process', {
    exports: {
      spawn: (bin: string, args: string[], options: { env: NodeJS.ProcessEnv }): FakeChild => {
        world.spawns.push({ bin, args, env: options.env })
        world.probedVia.push(world.selection ?? '')
        world.onSpawn?.(world.spawns.length)
        const outcome = nextOutcome(world.selection ?? '')
        if (outcome.kind === 'throw') {
          throw new Error('spawn failed')
        }
        const child = new FakeChild()
        emitOutcome(child, outcome, args)
        return child
      }
    }
  })
  mock.module('node:perf_hooks', { exports: { performance: { now: () => world.perfNowMs } } })
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
      getAppConfig: async () => world.appConfig,
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
          throw new Error('mihomo is down')
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
        if (world.afterUpdateSelection !== undefined) {
          world.selection = world.afterUpdateSelection
        }
      }
    }
  })
}

/** 每个用例都要从零开始：探针的几个模块各自带着内存状态。 */
const AGY_MODULES = [
  './sparkleAgyCli',
  './sparkleAgyProbeSnapshot',
  './sparkleAgyGroupControl',
  './sparkleAgyProbe'
] as const

/** 本用例里探针当前的展示快照。 */
export function snapshot(): AgyProbeSnapshot {
  return (require('./sparkleAgyProbeSnapshot') as typeof AgySnapshot).getSparkleAgyProbeSnapshot()
}

/** 用缓存与订阅节点重建展示快照（探针自己在每轮的固定位置做这件事）。 */
export function syncSnapshot(
  proxies: Proxy[] = world.profileProxies,
  cache: ReadonlyMap<string, { usable: boolean; rttMs: number; checkedAt: number }> = new Map()
): void {
  ;(require('./sparkleAgyProbeSnapshot') as typeof AgySnapshot).syncAgyProbeSnapshot(cache, proxies)
}

/** 本用例里的 agy CLI 请求模块（探针的最底层，可直接驱动）。 */
export function agyCli(): typeof AgyCli {
  return require('./sparkleAgyCli') as typeof AgyCli
}

/** 本用例里的 agy 组操作模块（探针的下层，可直接驱动）。 */
export function groupControl(): typeof AgyGroupControl {
  return require('./sparkleAgyGroupControl') as typeof AgyGroupControl
}

const SECRET_ENV_NAMES = [
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GOOGLE_API_KEY',
  'CLOUD_CODE_URL'
] as const

export function useAgyRig(): () => typeof AgyProbe {
  let probe: typeof AgyProbe
  const savedEnv = new Map<string, string | undefined>()

  before(() => {
    installMocks()
    for (const name of ['HOME', ...SECRET_ENV_NAMES]) {
      savedEnv.set(name, process.env[name])
    }
  })
  after(() => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  })
  beforeEach(() => {
    resetWorld()
    for (const dir of Object.values(dirs)) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    }
    process.env.HOME = dirs.home
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW })
    for (const module of AGY_MODULES) {
      delete require.cache[require.resolve(module)]
    }
    probe = require('./sparkleAgyProbe') as typeof AgyProbe
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return () => probe
}
