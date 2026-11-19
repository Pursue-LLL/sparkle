// [INPUT] node:assert · proxyNodeFingerprintCore
// [OUTPUT] NOW · 时间常量 · 节点夹具（TW1…US1/HK1/ANYTLS/NODES/POOL）· cacheKey/cacheRecord · CliOutcome 及常用结局（含只有 CLI 日志里才有 aicode 拒绝 / 超时记录的两种日志与结局）· dialFailureLine · world · resetWorld · callsStarting · outcomesByNode · assertLog/assertNoLog
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
export const POOL = ['台湾-1', '台湾-2', '台湾-AnyTLS', '日本-1', '韩国-1', '新加坡-1', '美国-1']

export const cacheKey = (proxy: Proxy): string => computeProxyNodeFingerprint(proxy)

export function cacheRecord(
  usable: boolean,
  rttMs = 100,
  ageMs = 0
): { usable: boolean; rttMs: number; checkedAt: number } {
  return { usable, rttMs, checkedAt: NOW - ageMs }
}

/**
 * 假 agy CLI 的结局；rttMs 是这次请求「花掉」的耗时，默认 1ms；
 * log 是进程退出前按 `--log-file` 写到磁盘的日志，不给就不写（真实 CLI 没写出日志的情形）。
 */
export type CliOutcome = (
  | { kind: 'ok' }
  | { kind: 'location' }
  | { kind: 'hang' }
  | { kind: 'error' }
  | { kind: 'throw' }
  | { kind: 'chunks'; chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }>; code: number }
) & { rttMs?: number; log?: string }

export const OK: CliOutcome = { kind: 'ok' }
export const LOCATION: CliOutcome = { kind: 'location' }
export const HANG: CliOutcome = { kind: 'hang' }
export const okAfter = (rttMs: number): CliOutcome => ({ kind: 'ok', rttMs })

/** 官方 CLI 日志里 aicode 拒绝出口地区的片段（真实日志的形状：先超时，再带着 403 重试）。 */
export const AICODE_REJECTION_LOG = [
  'W1119 15:05:46.363174     296 code_assist_client.go:509] CCPA routed this account to AICode, but AICode FetchConfig failed, serving CCPA\'s flags: failed to make AI Code FetchConfig request: Get "https://aicode.googleapis.com/v1alpha:fetchConfig": context deadline exceeded',
  'W1119 15:05:47.028126     472 code_assist_client.go:475] AICode FetchConfig failed, falling back to CCPA ListExperiments: failed to make AI Code FetchConfig request: "403 Forbidden"',
  '    "message": "Your location is not eligible for this service at this time. Detected location: CN.",',
  '        "reason": "LOCATION_NOT_ELIGIBLE",'
].join('\n')

/** aicode 只是超时、没有拒绝地区的日志（健康出口上同样会出现）。 */
export const AICODE_TIMEOUT_LOG =
  'W1119 15:35:51.473676     320 code_assist_client.go:509] CCPA routed this account to AICode, but AICode FetchConfig failed, serving CCPA\'s flags: failed to make AI Code FetchConfig request: Get "https://aicode.googleapis.com/v1alpha:fetchConfig": context deadline exceeded'

/** 生成请求成功（退出码 0），但 aicode 在日志里拒绝了这个出口的地区。 */
export const OK_BUT_AICODE_REJECTED: CliOutcome = { kind: 'ok', log: AICODE_REJECTION_LOG }

/** 内核对一条拨号失败的 TCP 连接打的 warning（真实日志的形状，见 verify:failover 对真实内核的校验）。 */
export const dialFailureLine = (group: string, source = '198.18.0.1:62341(agy)'): string =>
  `[TCP] dial ${group} (match DomainKeyword/cloudcode-pa) ${source} --> daily-cloudcode-pa.googleapis.com:443 error: 36.232.22.213:18115 connect error: dial tcp 36.232.22.213:18115: i/o timeout`

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
  /** 隐藏探测通道当前固定的节点；探测进程每次启动时的出口就是它。 */
  channelNode: undefined as string | undefined,
  /** 通道切不到的节点（订阅里没有它之类）：切换接口报错。 */
  channelRefused: new Set<string>(),
  /** 控制器整体不可用：通道切换一律报错。 */
  channelFailure: false,
  groupMissing: false,
  changeRefused: new Set<string>(),
  /** 切换接口本身报错（而不是返回「没切成」）。 */
  changeFailure: false,
  closeFailure: false,
  updateFailure: undefined as undefined | { reason: unknown },
  /** 重载 provider 后 mihomo 把组选择落到这个节点，而不是「选中节点还在就保持、没了落到第一个」。 */
  afterUpdateSelection: undefined as string | undefined,
  /** 按出场顺序消耗；用完后按节点查 outcomeByNode，再回落 defaultOutcome。 */
  outcomes: [] as CliOutcome[],
  outcomeByNode: {} as Record<string, CliOutcome>,
  defaultOutcome: OK as CliOutcome,
  /** 每次启动 agy 时隐藏探测通道固定的节点（探测结论归属的出口）。 */
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
  /** subscribeMihomoAlerts 登记的监听器；用例经 emitAlert 向它们投递内核告警。 */
  alertListeners: [] as Array<(log: ControllerLog) => void>,
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
  world.channelNode = undefined
  world.channelRefused = new Set()
  world.channelFailure = false
  world.groupMissing = false
  world.changeRefused = new Set()
  world.changeFailure = false
  world.closeFailure = false
  world.updateFailure = undefined
  world.afterUpdateSelection = undefined
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
  world.alertListeners = []
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
