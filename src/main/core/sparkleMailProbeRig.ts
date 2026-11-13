// [INPUT] node:test 假时钟与模块替身 · sparkleMailProbe / sparkleMailCurrentNodeProbe（被测模块，每个用例重新加载）· 临时目录里的真实缓存与 provider 文件 ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleMailProviderCore::MAIL_NODE_PROVIDER_FILENAME (POS: 邮件 provider 与分组配置) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具) ·
//         utils/yaml::parseYaml (POS: YAML 解析与序列化)
// [OUTPUT] useMailRig · world · NODES · cacheRecord/cacheKey · 文件读写辅助 · 断言辅助
// [POS] 邮件 provider 探测的行为测试夹具：配置、mihomo 控制器、端口探测与日志用替身，
// 探测缓存与 sparkle-mail provider 文件走临时目录里的真实文件。仅供测试使用。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml } from '../utils/yaml'
import { flush } from './groupFailoverEngineHarness'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { MAIL_NODE_PROVIDER_FILENAME } from './sparkleMailProviderCore'
import type * as CurrentNodeProbe from './sparkleMailCurrentNodeProbe'
import type * as MailProbe from './sparkleMailProbe'
import { mockFsPromisesSync } from './syncFsPromisesRig'

export const NOW = 1_700_000_000_000
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
const CACHE_FILENAME = 'sparkle-mail-nodes.json'

export type Proxy = Record<string, unknown>

export const HY2_TW: Proxy = {
  name: '台湾-HY2',
  type: 'hysteria2',
  server: 'tw-hy2.example.com',
  port: 443
}
export const VLESS_JP: Proxy = {
  name: '日本-VLESS',
  type: 'vless',
  server: 'jp-vless.example.com',
  port: 443
}
export const SS_TW: Proxy = { name: '台湾-SS', type: 'ss', server: 'tw-ss.example.com', port: 8388 }
export const SS_US: Proxy = { name: '美国-SS', type: 'ss', server: 'us-ss.example.com', port: 8388 }
export const ANYTLS_TW: Proxy = {
  name: '台湾-AnyTLS',
  type: 'anytls',
  server: 'tw-anytls.example.com',
  port: 443
}
export const NODES: Proxy[] = [HY2_TW, VLESS_JP, SS_TW, SS_US, ANYTLS_TW]

export const cacheKey = (proxy: Proxy): string => computeProxyNodeFingerprint(proxy)

export function cacheRecord(
  alive: boolean,
  rttMs = alive ? 100 : 0,
  ageMs = 0
): { alive: boolean; rttMs: number; checkedAt: number } {
  return { alive, rttMs, checkedAt: NOW - ageMs }
}

export interface PortVerdict {
  alive: boolean
  rttMs: number
}

export const world = {
  profile: { current: 'p1' } as { current?: string },
  profileError: false,
  profileProxies: NODES as Proxy[],
  appConfig: {} as { proxySwitchPriority?: string[] },
  appConfigReads: 0,
  portVerdictOf: (_node: string): PortVerdict => ({ alive: true, rttMs: 50 }),
  portProbeFailure: undefined as undefined | { reason: unknown },
  onPortProbe: undefined as undefined | ((node: string) => Promise<void> | void),
  updateFailure: undefined as undefined | { reason: unknown },
  delayFailure: undefined as undefined | { reason: unknown },
  connections: undefined as undefined | { connections: Array<{ chains?: string[] }> },
  connectionsFailure: false,
  group: { now: undefined as string | undefined, all: [] as string[] },
  groupFailure: undefined as undefined | { reason: unknown },
  logHandler: undefined as undefined | ((log: { type: string; payload: string }) => void),
  subscriptions: 0,
  calls: [] as string[],
  logs: [] as string[]
}

function resetWorld(): void {
  world.profile = { current: 'p1' }
  world.profileError = false
  world.profileProxies = NODES
  world.appConfig = {}
  world.appConfigReads = 0
  world.portVerdictOf = () => ({ alive: true, rttMs: 50 })
  world.portProbeFailure = undefined
  world.onPortProbe = undefined
  world.updateFailure = undefined
  world.delayFailure = undefined
  world.connections = undefined
  world.connectionsFailure = false
  world.group = { now: undefined, all: [] }
  world.groupFailure = undefined
  world.logHandler = undefined
  world.subscriptions = 0
  world.calls = []
  world.logs = []
}

/** 整个测试进程共用一个临时根目录，进程结束时清理；用例之间各自重建 data/profiles 子目录。 */
const root = mkdtempSync(path.join(tmpdir(), 'sparkle-mail-probe-'))
process.once('exit', () => rmSync(root, { recursive: true, force: true }))

const dirs = { data: path.join(root, 'data'), profiles: path.join(root, 'profiles') }

const cacheFile = (): string => path.join(dirs.data, CACHE_FILENAME)
const providerFile = (): string => path.join(dirs.profiles, MAIL_NODE_PROVIDER_FILENAME)

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

export function writeCache(records: Record<string, unknown>): void {
  writeFileSync(cacheFile(), JSON.stringify(records), 'utf8')
}

export function writeCacheRaw(text: string): void {
  writeFileSync(cacheFile(), text, 'utf8')
}

export function readCache(): Record<string, { alive: boolean; rttMs: number; checkedAt: number }> {
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
  writeFileSync(providerFile(), `proxies:\n${names.map((name) => `  - name: ${name}\n`).join('')}`)
}

export function writeProviderRaw(text: string): void {
  writeFileSync(providerFile(), text, 'utf8')
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

let mocksInstalled = false

/** node:test 对同一个模块只允许替换一次，所以多处调用 useMailRig 时只装一次。 */
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
      getAppConfig: async () => {
        world.appConfigReads += 1
        return world.appConfig
      },
      getProfileConfig: async () => {
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
      probeSingleNodeMailPorts: async (node: string): Promise<PortVerdict> => {
        world.calls.push(`probe:${node}`)
        await world.onPortProbe?.(node)
        if (world.portProbeFailure) {
          throw world.portProbeFailure.reason
        }
        return world.portVerdictOf(node)
      }
    }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoUpdateProxyProviders: async (name: string): Promise<void> => {
        world.calls.push(`update:${name}`)
        if (world.updateFailure) {
          throw world.updateFailure.reason
        }
      },
      mihomoGroupDelay: async (group: string, url: string): Promise<void> => {
        world.calls.push(`delay:${group}:${url}`)
        if (world.delayFailure) {
          throw world.delayFailure.reason
        }
      },
      mihomoGetConnections: async (): Promise<unknown> => {
        if (world.connectionsFailure) {
          throw new Error('connections unavailable')
        }
        return world.connections
      },
      mihomoGroupDetail: async (group: string): Promise<typeof world.group> => {
        world.calls.push(`detail:${group}`)
        if (world.groupFailure) {
          throw world.groupFailure.reason
        }
        return world.group
      },
      subscribeMihomoLogs: (handler: (log: { type: string; payload: string }) => void): void => {
        world.subscriptions += 1
        world.logHandler = handler
      }
    }
  })
}

export interface MailRig {
  probe: () => typeof MailProbe
  current: () => typeof CurrentNodeProbe
}

/**
 * 每个用例重新加载两个被测模块（它们的开关、队列与定时器都在模块作用域），
 * 先装 sparkleMailProbe 再装 sparkleMailCurrentNodeProbe，两者就共用同一份实例，与生产一致。
 */
export function useMailRig(): MailRig {
  let probe: typeof MailProbe
  let current: typeof CurrentNodeProbe

  before(installMocks)
  beforeEach(() => {
    resetWorld()
    rmSync(dirs.data, { recursive: true, force: true })
    rmSync(dirs.profiles, { recursive: true, force: true })
    mkdirSync(dirs.data, { recursive: true })
    mkdirSync(dirs.profiles, { recursive: true })
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW })
    delete require.cache[require.resolve('./sparkleMailProbe')]
    delete require.cache[require.resolve('./sparkleMailCurrentNodeProbe')]
    probe = require('./sparkleMailProbe') as typeof MailProbe
    current = require('./sparkleMailCurrentNodeProbe') as typeof CurrentNodeProbe
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return { probe: () => probe, current: () => current }
}
