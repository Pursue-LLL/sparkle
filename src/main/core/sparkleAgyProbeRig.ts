// [INPUT] node:test 假时钟与模块替身 · sparkleAgyProbe（被测模块，每个用例重新加载）· 临时目录里的真实 HOME / 数据目录 / provider 文件 · 假的 agy CLI 进程
// [OUTPUT] useAgyRig · world · NODES · cacheKey/cacheRecord · 文件读写辅助 · runBootstrap · 断言辅助
// [POS] sparkleAgyProbe 行为测试夹具：配置、mihomo 控制器与日志用替身，agy CLI 用可编排结局的假子进程，
// 探测缓存、provider 文件与探测目录走临时目录里的真实文件。仅供测试使用。

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import { flush } from './groupFailoverEngineHarness'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { AGY_NODE_PROVIDER_FILENAME } from './sparkleAgyProviderCore'
import type * as AgyProbe from './sparkleAgyProbe'
import { mockFsPromisesSync } from './syncFsPromisesRig'

export const NOW = 1_700_000_000_000
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const AGY_GROUP = '🎯 agy 专用'
const CACHE_FILENAME = 'sparkle-agy-nodes.json'

export type Proxy = Record<string, unknown>

const ss = (name: string, host: string): Proxy => ({
  name,
  type: 'ss',
  server: `${host}.example.com`,
  port: 443
})

export const TW1 = ss('台湾-1', 'tw1')
export const TW2 = ss('台湾-2', 'tw2')
export const JP1 = ss('日本-1', 'jp1')
export const KR1 = ss('韩国-1', 'kr1')
export const SG1 = ss('新加坡-1', 'sg1')
export const US1 = ss('美国-1', 'us1')
export const HK1 = ss('香港-1', 'hk1')
export const ANYTLS: Proxy = {
  name: '台湾-AnyTLS',
  type: 'anytls',
  server: 'anytls.example.com',
  port: 443
}
export const NODES: Proxy[] = [TW1, TW2, JP1, KR1, SG1, US1, HK1, ANYTLS]
/** 进得了 agy 池的节点，顺序同默认地区优先级。 */
export const POOL = ['台湾-1', '台湾-2', '日本-1', '韩国-1', '新加坡-1', '美国-1']

export const cacheKey = (proxy: Proxy): string => computeProxyNodeFingerprint(proxy)

export function cacheRecord(
  usable: boolean,
  rttMs = 100,
  ageMs = 0
): { usable: boolean; rttMs: number; checkedAt: number } {
  return { usable, rttMs, checkedAt: NOW - ageMs }
}

/** 假 agy CLI 的结局；rttMs 是这次请求「花掉」的耗时，默认 1ms。 */
export type CliOutcome = (
  | { kind: 'ok' }
  | { kind: 'location' }
  | { kind: 'auth' }
  | { kind: 'fail' }
  | { kind: 'hang' }
  | { kind: 'error' }
  | { kind: 'throw' }
  | { kind: 'chunks'; chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }>; code: number }
) & { rttMs?: number }

export const OK: CliOutcome = { kind: 'ok' }
export const LOCATION: CliOutcome = { kind: 'location' }
export const HANG: CliOutcome = { kind: 'hang' }
export const okAfter = (rttMs: number): CliOutcome => ({ kind: 'ok', rttMs })

export interface Spawned {
  bin: string
  args: string[]
  env: NodeJS.ProcessEnv
}

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

export const world = {
  profile: { current: 'p1' } as { current?: string },
  profileFailure: undefined as undefined | { reason: unknown },
  profileReads: 0,
  profileProxies: NODES as Proxy[],
  appConfig: {} as { proxySwitchPriority?: string[] },
  selection: '台湾-1' as string | undefined,
  members: [...POOL],
  groupMissing: false,
  changeRefused: new Set<string>(),
  closeFailure: false,
  updateFailure: undefined as undefined | { reason: unknown },
  /** 按出场顺序消耗；用完后按节点查 outcomeByNode，再回落 defaultOutcome。 */
  outcomes: [] as CliOutcome[],
  outcomeByNode: {} as Record<string, CliOutcome>,
  defaultOutcome: OK as CliOutcome,
  /** 每次启动 agy 时组里选中的节点（探测结论归属的出口）。 */
  probedVia: [] as string[],
  spawns: [] as Spawned[],
  killed: [] as string[],
  killFailure: false,
  /** performance.now() 的假读数：假进程「完成」时按 rttMs 推进，探测耗时因此可精确编排。 */
  perfNowMs: 0,
  /** 悬挂中的假进程等多久才会被探测超时杀掉；runBootstrap 据此推进时钟。 */
  hangingTimeoutMs: undefined as number | undefined,
  /** 每次启动 agy 之前调用，参数是这是第几次启动（从 1 开始）。 */
  onSpawn: undefined as undefined | ((count: number) => void),
  calls: [] as string[],
  logs: [] as string[],
  logFailure: false
}

function resetWorld(): void {
  world.profile = { current: 'p1' }
  world.profileFailure = undefined
  world.profileReads = 0
  world.profileProxies = NODES
  world.appConfig = {}
  world.selection = '台湾-1'
  world.members = [...POOL]
  world.groupMissing = false
  world.changeRefused = new Set()
  world.closeFailure = false
  world.updateFailure = undefined
  world.outcomes = []
  world.outcomeByNode = {}
  world.defaultOutcome = OK
  world.probedVia = []
  world.spawns = []
  world.killed = []
  world.killFailure = false
  world.perfNowMs = 0
  world.hangingTimeoutMs = undefined
  world.onSpawn = undefined
  world.calls = []
  world.logs = []
  world.logFailure = false
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

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

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

/** 跑完一轮 bootstrap；途中悬挂的假进程由这里推进时钟让探测超时。 */
export async function runBootstrap(agy: typeof AgyProbe): Promise<void> {
  const state = { finished: false }
  const run = agy.bootstrapSparkleAgyProvider().finally(() => {
    state.finished = true
  })
  for (let guard = 0; guard < 500 && !state.finished; guard++) {
    await settle()
    if (!state.finished) {
      expireHangingProbe()
    }
  }
  await run
}

/** 让每个节点各自有一个固定结局。 */
export function outcomesByNode(outcomes: Record<string, CliOutcome>): void {
  world.outcomeByNode = outcomes
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
      case 'auth':
        child.stderr.emit('data', Buffer.from('error: not logged in, please sign in first'))
        child.emit('close', 1)
        break
      case 'fail':
        child.stderr.emit('data', Buffer.from('internal error'))
        child.emit('close', 2)
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
      }
    }
  })
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
    delete require.cache[require.resolve('./sparkleAgyProbe')]
    probe = require('./sparkleAgyProbe') as typeof AgyProbe
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return () => probe
}
