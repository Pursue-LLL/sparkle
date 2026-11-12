// [INPUT] node:assert · proxyNodeFingerprintCore
// [OUTPUT] NOW · 时间常量 · 节点夹具（HK1/TW1/JP1/US1/SG1/NODES/CANDIDATES/makeNodes/nameOf）· cacheKey/cacheRecord · Routed 结局及常用结局 · world · resetWorld · callsStarting · assertLog/assertNoLog
// [POS] sparkleGrokProbe 行为测试的共享状态与夹具数据：world 是替身（配置、mihomo 控制器、axios）读写的唯一状态，
// 用例通过它编排场景、读取观察结果。仅供测试使用。

import assert from 'node:assert/strict'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

export const NOW = 1_700_000_000_000
export const SECOND_MS = 1000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const GROK_GROUP = 'grok 专用'

export type Proxy = Record<string, unknown>

const ss = (name: string, host: string): Proxy => ({
  name,
  type: 'ss',
  server: `${host}.example.com`,
  port: 443
})

export const HK1 = ss('香港-1', 'hk1')
export const TW1 = ss('台湾-1', 'tw1')
export const JP1 = ss('日本-1', 'jp1')
export const US1 = ss('美国-1', 'us1')
export const SG1 = ss('新加坡-1', 'sg1')
/** 订阅顺序：香港排第一，验证它不会因此被优先选用。 */
export const NODES: Proxy[] = [HK1, TW1, JP1, US1, SG1]
/** 还没有任何验证结论时的候选顺序：非香港保持订阅顺序，香港垫底。 */
export const CANDIDATES = ['台湾-1', '日本-1', '美国-1', '新加坡-1', '香港-1']

/** 想要超过单轮探测上限（6 个）时用：线路-01、线路-02……，名字排序与序号一致。 */
export const makeNodes = (count: number): Proxy[] =>
  Array.from({ length: count }, (_, index) => {
    const serial = String(index + 1).padStart(2, '0')
    return ss(`线路-${serial}`, `n${serial}`)
  })

export const nameOf = (proxy: Proxy): string => String(proxy.name)

export const cacheKey = (proxy: Proxy): string => computeProxyNodeFingerprint(proxy)

export interface CacheRecord {
  alive: boolean
  rttMs: number
  checkedAt: number
  status?: number
  reason?: string
}

export function cacheRecord(alive: boolean, rttMs = 100, ageMs = 0): CacheRecord {
  return { alive, rttMs, checkedAt: NOW - ageMs }
}

/** 假 axios 对一次 grok.com 请求的回应；rttMs 是这次请求「花掉」的时间，默认 5ms。 */
export type Routed =
  | { kind: 'response'; status: number; cfMitigated?: string; rttMs?: number }
  | { kind: 'failure'; error: unknown; rttMs?: number }
  | { kind: 'hang' }

export const ok = (rttMs = 5): Routed => ({ kind: 'response', status: 200, rttMs })
export const challenge = (rttMs = 5): Routed => ({
  kind: 'response',
  status: 403,
  cfMitigated: 'challenge',
  rttMs
})
export const networkFailure = (message = 'timeout of 8000ms exceeded', rttMs = 8000): Routed => ({
  kind: 'failure',
  error: new Error(message),
  rttMs
})
export const HANG: Routed = { kind: 'hang' }

export interface RequestRecord {
  /** 发请求时组里选中的节点（这次结论归属的出口）。 */
  via: string
  config: Record<string, unknown>
}

export const world = {
  profile: { current: 'p1' } as { current?: string },
  profileFailure: undefined as undefined | { reason: unknown },
  profileReads: 0,
  profileProxies: NODES as Proxy[],
  controlled: { 'mixed-port': 7890 } as Record<string, unknown>,
  controlledFailure: false,
  selection: '台湾-1' as string | undefined,
  members: ['香港-1', '台湾-1', '日本-1', '美国-1', '新加坡-1'],
  groupMissing: false,
  changeRefused: new Set<string>(),
  closeFailure: false,
  updateFailure: undefined as undefined | { reason: unknown },
  /** 按出场顺序消耗；用完后按节点查 routedByNode，再回落 defaultRouted。 */
  routedQueue: [] as Routed[],
  routedByNode: {} as Record<string, Routed>,
  defaultRouted: ok() as Routed,
  requests: [] as RequestRecord[],
  groupDelays: {} as Record<string, number>,
  groupDelayFailure: undefined as undefined | { reason: unknown },
  groupDelayTakesMs: 40,
  groupDelayCalls: [] as Array<{ group: string; url: string; options: unknown }>,
  calls: [] as string[],
  logs: [] as string[],
  logFailure: false
}

export function resetWorld(): void {
  world.profile = { current: 'p1' }
  world.profileFailure = undefined
  world.profileReads = 0
  world.profileProxies = NODES
  world.controlled = { 'mixed-port': 7890 }
  world.controlledFailure = false
  world.selection = '台湾-1'
  world.members = ['香港-1', '台湾-1', '日本-1', '美国-1', '新加坡-1']
  world.groupMissing = false
  world.changeRefused = new Set()
  world.closeFailure = false
  world.updateFailure = undefined
  world.routedQueue = []
  world.routedByNode = {}
  world.defaultRouted = ok()
  world.requests = []
  world.groupDelays = {}
  world.groupDelayFailure = undefined
  world.groupDelayTakesMs = 40
  world.groupDelayCalls = []
  world.calls = []
  world.logs = []
  world.logFailure = false
}

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

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
