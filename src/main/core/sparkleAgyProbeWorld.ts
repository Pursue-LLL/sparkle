// [INPUT] node:assert · proxyNodeFingerprintCore
// [OUTPUT] NOW · 时间常量 · 节点夹具（TW1…US1/HK1/ANYTLS/NODES/POOL）· cacheKey/cacheRecord · CliOutcome 及常用结局 · world · resetWorld · callsStarting · outcomesByNode · assertLog/assertNoLog
// [POS] sparkleAgyProbe 行为测试的共享状态与夹具数据：world 是替身（配置、mihomo 控制器、假 agy CLI）读写的唯一状态，
// 用例通过它编排场景、读取观察结果。仅供测试使用。

import assert from 'node:assert/strict'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'

export const NOW = 1_700_000_000_000
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const AGY_GROUP = '🎯 agy 专用'
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

export function resetWorld(): void {
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

export const callsStarting = (prefix: string): string[] =>
  world.calls.filter((call) => call.startsWith(prefix))

/** 让每个节点各自有一个固定结局。 */
export function outcomesByNode(outcomes: Record<string, CliOutcome>): void {
  world.outcomeByNode = outcomes
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
