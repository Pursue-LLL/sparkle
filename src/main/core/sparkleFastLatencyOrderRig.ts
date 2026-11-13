// [INPUT] node:test 假时钟与模块替身 · sparkleFastLatencyOrder（被测模块，每个用例重新加载）· 临时目录里的真实 sparkle-fast 文件与延迟快照 ·
//         defaultAutoSwitchProxy::AUTO_SELECT_GEMINI_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         groupFailoverEngineHarness::flush (POS: 故障转移引擎测试夹具) ·
//         sparkleFastDelaySnapshotCore::serializeSparkleFastDelaySnapshot (POS: 延迟快照数据层) ·
//         sparkleFastProviderCore::FAST_NODE_PROVIDER_FILENAME/FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         syncFsPromisesRig::mockFsPromisesSync (POS: fs/promises 同步化夹具) ·
//         utils/yaml::parseYaml/stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] useFastOrderRig · world · NODES · samplesFor · 文件读写辅助（readOrder/writeNodes/readSnapshot/writeSnapshot）· tickRefresh · 断言辅助
// [POS] sparkleFastLatencyOrder 行为测试夹具：mihomo 控制器、拨测与日志用替身，
// provider 文件与快照走临时目录里的真实文件。仅供测试使用。

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, afterEach, before, beforeEach, mock } from 'node:test'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import { flush } from './groupFailoverEngineHarness'
import { serializeSparkleFastDelaySnapshot } from './sparkleFastDelaySnapshotCore'
import { FAST_NODE_PROVIDER_FILENAME, FAST_NODE_PROVIDER_ID } from './sparkleFastProviderCore'
import { mockFsPromisesSync } from './syncFsPromisesRig'
import type * as FastOrder from './sparkleFastLatencyOrder'

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000
const SNAPSHOT_FILENAME = 'sparkle-fast-delays.json'

type Proxy = Record<string, unknown>

export const NODES: Proxy[] = [
  { name: '台湾-1', type: 'ss', server: 'tw1.example.com', port: 443 },
  { name: '台湾-2', type: 'ss', server: 'tw2.example.com', port: 443 },
  { name: '日本-1', type: 'ss', server: 'jp1.example.com', port: 443 },
  { name: '美国-1', type: 'ss', server: 'us1.example.com', port: 443 }
]

/** mihomo 在 provider 接口里给出的节点样本；delay 缺省表示没有任何成功样本。 */
export function samplesFor(delays: Record<string, number | undefined>): Proxy[] {
  return Object.entries(delays).map(([name, delay]) => ({
    name,
    alive: delay !== undefined,
    extra:
      delay === undefined
        ? {}
        : { [AUTO_SELECT_GEMINI_PROBE_URL]: { alive: true, history: [{ delay }] } }
  }))
}

export const world = {
  appConfig: {} as { proxySwitchPriority?: string[] },
  providerProxies: [] as Proxy[],
  pinned: undefined as string | undefined,
  groupError: false,
  blocked: new Set<string>(),
  onProbe: undefined as undefined | (() => void),
  probeFailure: undefined as undefined | { reason: unknown },
  providersError: undefined as Error | undefined,
  calls: [] as string[],
  logs: [] as string[]
}

function resetWorld(): void {
  world.appConfig = {}
  world.providerProxies = []
  world.pinned = undefined
  world.groupError = false
  world.blocked = new Set()
  world.onProbe = undefined
  world.probeFailure = undefined
  world.providersError = undefined
  world.calls = []
  world.logs = []
}

const dirs = { data: '', profiles: '' }

const providerFile = (): string => path.join(dirs.profiles, FAST_NODE_PROVIDER_FILENAME)
const snapshotFile = (): string => path.join(dirs.data, SNAPSHOT_FILENAME)

export function writeNodes(nodes: Proxy[] = NODES): void {
  writeFileSync(providerFile(), stringifyYaml({ proxies: nodes }), 'utf8')
}

export function removeNodes(): void {
  rmSync(providerFile(), { force: true })
}

export function readOrder(): string[] {
  const { proxies = [] } = parseYaml<{ proxies?: Proxy[] }>(readFileSync(providerFile(), 'utf8'))
  return proxies.map((proxy) => String(proxy.name))
}

/** 按给定节点配置写一份延迟快照（默认与当前 provider 文件一致）。 */
export function writeSnapshot(samples: Record<string, number>, nodes: Proxy[] = NODES): void {
  writeFileSync(
    snapshotFile(),
    serializeSparkleFastDelaySnapshot(nodes, new Map(Object.entries(samples))),
    'utf8'
  )
}

export function readSnapshot(): {
  version: number
  providerFingerprint: string
  samples: Record<string, number>
} {
  return JSON.parse(readFileSync(snapshotFile(), 'utf8'))
}

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await flush()
  }
}

/** 推进一个周期复查的间隔并等这一轮跑完。 */
export async function tickRefresh(): Promise<void> {
  mock.timers.tick(REFRESH_INTERVAL_MS)
  await settle()
}

export function assertLog(fragment: string): void {
  assert.ok(
    world.logs.some((line) => line.includes(fragment)),
    `missing log "${fragment}" in:\n${world.logs.join('')}`
  )
}

function installMocks(): void {
  mockFsPromisesSync()
  mock.module('../utils/dirs', {
    exports: { dataDir: () => dirs.data, profilesDir: () => dirs.profiles }
  })
  mock.module('../config', {
    exports: { getAppConfig: async () => world.appConfig }
  })
  mock.module('../utils/log', {
    exports: {
      appendAppLog: async (line: string): Promise<void> => {
        world.logs.push(line)
      }
    }
  })
  mock.module('./mihomoApi', {
    exports: {
      mihomoProxyProviders: async (): Promise<unknown> => {
        if (world.providersError) {
          throw world.providersError
        }
        return { providers: { [FAST_NODE_PROVIDER_ID]: { proxies: world.providerProxies } } }
      },
      mihomoGroupDetail: async (name: string): Promise<{ fixed?: string }> => {
        world.calls.push(`detail:${name}`)
        if (world.groupError) {
          throw new Error('controller down')
        }
        return { fixed: world.pinned }
      },
      mihomoUnfixedProxy: async (name: string): Promise<void> => {
        world.calls.push(`unfix:${name}`)
      },
      mihomoUpdateProxyProviders: async (name: string): Promise<void> => {
        world.calls.push(`update:${name}`)
      }
    }
  })
  mock.module('./providerLeafProbe', {
    exports: {
      probeProviderLeavesGently: async (name: string): Promise<number> => {
        world.calls.push(`probe:${name}`)
        if (world.probeFailure) {
          throw world.probeFailure.reason
        }
        world.onProbe?.()
        return world.providerProxies.length
      }
    }
  })
  mock.module('./sparkleGeminiProbe', {
    exports: { loadGeminiBlockedNodeNames: async (): Promise<Set<string>> => world.blocked }
  })
}

export interface FastOrderHandle {
  bootstrap: () => Promise<void>
  startLoop: () => void
  loadSnapshot: (proxies: readonly Proxy[]) => Promise<ReadonlyMap<string, number>>
}

/** 在当前 describe 内注册钩子：替身、临时目录、假时钟、每个用例一份全新加载的被测模块。 */
export function useFastOrderRig(): FastOrderHandle {
  let order: typeof FastOrder
  let root = ''

  before(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sparkle-fast-order-'))
    installMocks()
  })
  after(() => {
    rmSync(root, { recursive: true, force: true })
  })
  beforeEach(() => {
    resetWorld()
    dirs.data = path.join(root, 'data')
    dirs.profiles = path.join(root, 'profiles')
    rmSync(dirs.data, { recursive: true, force: true })
    rmSync(dirs.profiles, { recursive: true, force: true })
    mkdirSync(dirs.data, { recursive: true })
    mkdirSync(dirs.profiles, { recursive: true })
    writeNodes()
    mock.timers.enable({ apis: ['setInterval'] })
    delete require.cache[require.resolve('./sparkleFastLatencyOrder')]
    order = require('./sparkleFastLatencyOrder') as typeof FastOrder
  })
  afterEach(() => {
    mock.timers.reset()
  })

  return {
    bootstrap: () => order.bootstrapSparkleFastLatencyOrder(),
    startLoop: () => order.startSparkleFastLatencyOrderLoop(),
    loadSnapshot: (proxies) => order.loadSparkleFastDelaySnapshot(proxies)
  }
}
