// [INPUT] 待巡检节点 · 已有缓存 · 内核 warning 告警 · 依赖注入（单点探测 / 时钟） ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyProviderCore::agyProxyName/AgyNodeProbeRecord/AgyProbeVerdict/AgyProxyRecord (POS: agy provider 与分组配置) ·
//         sparkleAgyReputation::flagAgyNode/AgyFlags (POS: agy 节点被拒记忆)
// [OUTPUT] runAgyAudit · shouldRepairAgyPin · isPinCheckDue · resolveAgyAuditBackoffMs · resolveProbeTimeoutMs · AGY_PIN_CHECK_INTERVAL_MS · AGY_DUTY_TICK_MS · AGY_HEADLESS_DEADLINE_MS · AGY_MIN_PROBE_TIMEOUT_MS · AGY_PIN_UNKNOWN_STREAK_LIMIT · AgyAuditOutcome · AgyAuditDeps · AgyAuditInput · AgyAuditResult ·
//          parseTcpDialFailureGroup · createAgyDialFailureWatch · AGY_DIAL_STORM_* · AGY_DIAL_OUTAGE_THRESHOLD
// [POS] agy 巡检状态机（纯编排，无 I/O）：决定哪些节点被测、何时中止、缓存如何演进，以及何时不等定时复测、
// 由生产流量的拨号失败风暴直接触发修复。
// I/O（单点探测、时钟）由调用方注入，便于用假探针验证「不可用不下结论 / 致命错误中止 / 预算超时」等分支。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  agyProxyName,
  type AgyNodeProbeRecord,
  type AgyProbeVerdict,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'
import { flagAgyNode, type AgyFlags } from './sparkleAgyReputation'

export interface AgyAuditOutcome {
  verdict: AgyProbeVerdict
  rttMs: number
  /** 探测手段本身不可用（agy CLI 起不来，或响应被判 `fatal`），继续巡检没有意义。 */
  fatal: boolean
}

export interface AgyAuditDeps {
  /** timeoutMs 已按截止时间收紧：探测不会拖过截止时间。 */
  probeNode: (nodeName: string, timeoutMs: number) => Promise<AgyAuditOutcome>
  now?: () => number
}

export interface AgyAuditInput {
  pending: readonly AgyProxyRecord[]
  cache: Map<string, AgyNodeProbeRecord>
  /** 整轮巡检预算；超时后剩余节点留待下一轮。 */
  budgetMs: number
  /** 单个节点探测的超时上限；慢 ≠ 坏，超时只记 unknown。 */
  probeTimeoutMs: number
  /** 绝对截止时间（ms）：剩余时间不够一次有意义的探测就不再开新的；省略表示不设限。 */
  deadlineAtMs?: number
  /** 修复扫描：拿到第一个 usable 就停，避免为了补全面把用户流量在更多候选节点之间来回拖。 */
  stopOnUsable?: boolean
  /** 本轮尝试过的节点（含超时这种不下结论的），供下一轮排序跳过、保证进度。 */
  attempted?: Map<string, number>
  /** 被拒记忆：探测判定出口不可用的节点记进去（通过的探测不会抹掉它）。 */
  flags?: AgyFlags
}

export interface AgyAuditResult {
  probed: number
  usable: number
  aborted: boolean
  /** 因截止时间到了而中止：没扫完候选，不代表池子里没有可用节点。 */
  outOfTime: boolean
  /** 本轮第一个判定可用的节点名；修复扫描用它作为最终选择。 */
  usableNode: string | null
}

/**
 * pin（当前钉住的节点）就地复测周期：只发 1 个最小请求（让 agy 回复 `OK`）、不切组、不断流。
 * 可用缓存 TTL 是 12h（sparkleAgyProbeCache），30 分钟一轮已有 24 倍余量；
 * 5 分钟一轮纯属浪费官方账号配额（实测 6.9k input/次）。
 */
export const AGY_PIN_CHECK_INTERVAL_MS = 30 * 60 * 1000

/** 常驻进程里「到期巡检」的节拍：每拍只读日志和状态（毫秒级），真正发探测请求的节奏由各自的到期时间决定。 */
export const AGY_DUTY_TICK_MS = 60 * 1000

/**
 * 无头调度进程从启动起必须收尾的时限：调度间隔 5 分钟，进程要在下一次被唤起之前退出，
 * 来不及的步骤留给下一次（状态落盘，不会丢）。
 */
export const AGY_HEADLESS_DEADLINE_MS = 210 * 1000

/** 低于这个时长的超时没有意义：CLI 冷启动加一次模型请求都跑不完，宁可不发。 */
export const AGY_MIN_PROBE_TIMEOUT_MS = 30 * 1000

/**
 * 一次探测在截止时间约束下能用的超时：不超过上限，也不超过截止前剩下的时间；
 * 剩下的时间不够一次有意义的探测时返回 undefined，调用方不发。
 */
export function resolveProbeTimeoutMs(
  limitMs: number,
  deadlineAtMs: number,
  nowMs: number
): number | undefined {
  const timeoutMs = Math.min(limitMs, deadlineAtMs - nowMs)
  return timeoutMs >= AGY_MIN_PROBE_TIMEOUT_MS ? timeoutMs : undefined
}

/** 距上次复测已满一个周期；系统时钟被回拨时按到期处理，不能因此永远不复测。 */
export function isPinCheckDue(lastCheckMs: number, nowMs: number): boolean {
  return nowMs < lastCheckMs || nowMs - lastCheckMs >= AGY_PIN_CHECK_INTERVAL_MS
}

/** pin 连续超时的容忍轮数：一次超时可能只是模型排队 / 上游整体变慢，连续两轮才认为出口不能用。 */
export const AGY_PIN_UNKNOWN_STREAK_LIMIT = 2

/**
 * pin 就地复测之后的处置：
 * - 明确 400 → 立即修复（此前已同节点复测一次排除账号轮转）；
 * - 没有 pin（组未生成 / 节点已从候选池消失）→ 立即修复；
 * - 超时 → 先累计轮次，连续 N 轮才修复，避免上游整体变慢时反复把生产出口拖去扫一遍；
 * - usable / fatal → 不修复（fatal 由调用方直接返回）。
 */
export function shouldRepairAgyPin(input: {
  pinVerdict: AgyProbeVerdict | null
  unknownStreak: number
}): boolean {
  if (input.pinVerdict === null || input.pinVerdict === 'unusable') {
    return true
  }
  if (input.pinVerdict === 'unknown') {
    return input.unknownStreak >= AGY_PIN_UNKNOWN_STREAK_LIMIT
  }
  return false
}

/**
 * 连续"全灭"轮次的退避：实测 Google 的拒绝是带冷却窗口的，
 * 越密集重试窗口越长，所以全灭后要主动拉长下一轮间隔（1×/2×/3× 封顶）。
 */
export function resolveAgyAuditBackoffMs(
  intervalMs: number,
  consecutiveEmptyRounds: number
): number {
  const multiplier = Math.min(Math.max(consecutiveEmptyRounds, 0), 3)
  return intervalMs * multiplier
}

export async function runAgyAudit(
  input: AgyAuditInput,
  deps: AgyAuditDeps
): Promise<AgyAuditResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  let probed = 0
  let usable = 0
  let usableNode: string | null = null

  for (const proxy of input.pending) {
    if (now() - startedAt > input.budgetMs) {
      return { probed, usable, aborted: true, outOfTime: false, usableNode }
    }
    const timeoutMs = resolveProbeTimeoutMs(
      input.probeTimeoutMs,
      input.deadlineAtMs ?? Number.POSITIVE_INFINITY,
      now()
    )
    if (timeoutMs === undefined) {
      return { probed, usable, aborted: true, outOfTime: true, usableNode }
    }

    const name = agyProxyName(proxy)
    const fingerprint = computeProxyNodeFingerprint(proxy)
    input.attempted?.set(fingerprint, now())
    const outcome = await deps.probeNode(name, timeoutMs)
    if (outcome.fatal) {
      return { probed, usable, aborted: true, outOfTime: false, usableNode }
    }
    // 限流 / 超时等无法定性的结果不写缓存，避免把健康节点误判成不可用。
    if (outcome.verdict === 'unknown') {
      continue
    }

    input.cache.set(fingerprint, {
      usable: outcome.verdict === 'usable',
      rttMs: outcome.rttMs,
      checkedAt: now()
    })
    if (outcome.verdict === 'unusable' && input.flags) {
      flagAgyNode(input.flags, fingerprint, now())
    }
    probed += 1
    if (outcome.verdict === 'usable') {
      usable += 1
      usableNode = name
      if (input.stopOnUsable) {
        break
      }
    }
  }

  return { probed, usable, aborted: false, outOfTime: false, usableNode }
}

/** 窗口内 agy 组的拨号失败达到该条数，判定当前出口已不可用：生产流量的失败是比定时复测更强的证据。 */
export const AGY_DIAL_STORM_THRESHOLD = 30
export const AGY_DIAL_STORM_WINDOW_MS = 120_000
/** 触发后的静默期：长于一轮修复扫描，扫描自己探测坏节点产生的失败不会再次触发。 */
export const AGY_DIAL_STORM_COOLDOWN_MS = 10 * 60_000
/**
 * 同一窗口内其它组的拨号失败达到该条数，说明是整网故障而不是 agy 出口的问题，不触发（换节点救不了断网）。
 * 独立于风暴阈值：整网故障的判据只取决于其它组是否同时在失败。
 */
export const AGY_DIAL_OUTAGE_THRESHOLD = 15

/**
 * mihomo 对每条拨号失败的 TCP 连接打一条 warning：
 * `[TCP] dial <组名> (match <规则>) <来源> --> <目标> error: <原因>`，组名是规则指向的出口组。
 * 这行文案是被动触发依赖的外部契约，`pnpm run verify:failover` 在真实内核上校验它。
 */
const TCP_DIAL_FAILURE_PATTERN = /^\[TCP\] dial (.+?) \(match /

/** 内核「TCP 拨号失败」告警所属的出口组名；其它日志返回 undefined。 */
export function parseTcpDialFailureGroup(log: { payload?: string }): string | undefined {
  return TCP_DIAL_FAILURE_PATTERN.exec(log.payload ?? '')?.[1]
}

/** 最近 `capacity` 次事件是否全部落在 `windowMs` 内：只留最近 capacity 个时间戳，内存与风暴规模无关。 */
function createBurstCounter(
  capacity: number,
  windowMs: number
): { record: (nowMs: number) => void; isBurst: (nowMs: number) => boolean } {
  const hits: number[] = []
  return {
    record: (nowMs) => {
      hits.push(nowMs)
      if (hits.length > capacity) {
        hits.shift()
      }
    },
    isBurst: (nowMs) => {
      const oldest = hits[0]
      return hits.length === capacity && oldest !== undefined && nowMs - oldest <= windowMs
    }
  }
}

export interface AgyDialFailureWatch {
  /** 喂入一条内核 warning 告警；返回 true 表示 agy 出口正在大面积拨号失败，应立即复核。 */
  observe: (log: { payload?: string }, nowMs: number) => boolean
}

/**
 * agy 出口的被动失效探测：定时复测按固定间隔采样，对抖动节点还会随机通过；
 * 而用户的真实流量一旦打到坏节点，内核每条连接都会记一条拨号失败告警。
 * 本函数只数这些现成的告警，不产生任何探测请求。
 */
export function createAgyDialFailureWatch(agyGroupName: string): AgyDialFailureWatch {
  const agyFailures = createBurstCounter(AGY_DIAL_STORM_THRESHOLD, AGY_DIAL_STORM_WINDOW_MS)
  const otherFailures = createBurstCounter(AGY_DIAL_OUTAGE_THRESHOLD, AGY_DIAL_STORM_WINDOW_MS)
  let cooldownUntilMs = 0

  return {
    observe: (log, nowMs) => {
      const group = parseTcpDialFailureGroup(log)
      if (group === undefined) {
        return false
      }
      if (group !== agyGroupName) {
        otherFailures.record(nowMs)
        return false
      }
      agyFailures.record(nowMs)
      if (nowMs < cooldownUntilMs || !agyFailures.isBurst(nowMs) || otherFailures.isBurst(nowMs)) {
        return false
      }
      cooldownUntilMs = nowMs + AGY_DIAL_STORM_COOLDOWN_MS
      return true
    }
  }
}
