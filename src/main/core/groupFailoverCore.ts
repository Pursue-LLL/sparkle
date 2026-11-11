// [INPUT] autoSwitchPolicy::isUrlTestGroupType (POS: 分组策略表) ·
//         proxyDelayVerdictCore::judgeProxyForUrl (POS: 延迟判定唯一规则) · proxyProbeHistoryCore::ProbeSource
// [OUTPUT] parseDialFailureGroup · recordDialFailure · planFailover · 阈值常量
// [POS] 故障转移的纯决策层（无 IO）。内核对一个组「连续拨号失败」时只会打一条 warning 告警并复测一次；
//       url-test 组的复测常常照旧通过，节点仍被选中而真实流量持续超时。这里把告警折算成「该组节点持续不可用」的判定，
//       并在组内挑出最近一次探测成功、延迟最低的替代节点。

import { isUrlTestGroupType } from './autoSwitchPolicy'
import { judgeProxyForUrl } from './proxyDelayVerdictCore'
import type { ProbeSource } from './proxyProbeHistoryCore'

/** 同一组两次计数告警的最小间隔：并发连接同时失败会连发多条，合并为一次事件。 */
export const DIAL_FAILURE_DEDUPE_MS = 30_000
/** 两次计数告警落在该窗口内，判定当前节点持续不可用。 */
export const DIAL_FAILURE_WINDOW_MS = 180_000
/** 被改选掉的节点不再被引擎选作目标的时长，也是引擎固定新节点的保留时长。 */
export const FAILOVER_HOLD_MS = 10 * 60_000
/** 候选节点最近一次成功探测的最大年龄（url-test 测速周期 300 s 的 3 倍），避免挑到久未验证的节点。 */
export const CANDIDATE_MAX_SAMPLE_AGE_MS = 15 * 60_000

const DIAL_FAILURE_PATTERN = /^because (.+) failed multiple times, activate health check$/

/** 内核「连续拨号失败」告警所属的组名；其它日志返回 undefined。 */
export function parseDialFailureGroup(log: { payload?: string }): string | undefined {
  return DIAL_FAILURE_PATTERN.exec(log.payload ?? '')?.[1]
}

export interface DialFailureState {
  lastCountedAt: number
  /** 窗口内已计数、尚未触发转移的那次告警时间。 */
  pendingAt: number | undefined
}

/** 告警折算：距上次计数不足去重间隔的忽略；窗口内第二次计数触发转移，触发后重新累计。 */
export function recordDialFailure(
  prev: DialFailureState | undefined,
  nowMs: number
): { next: DialFailureState; fire: boolean } {
  if (prev && nowMs - prev.lastCountedAt < DIAL_FAILURE_DEDUPE_MS) {
    return { next: prev, fire: false }
  }
  const fire = prev?.pendingAt !== undefined && nowMs - prev.pendingAt <= DIAL_FAILURE_WINDOW_MS
  return { next: { lastCountedAt: nowMs, pendingAt: fire ? undefined : nowMs }, fire }
}

export interface FailoverMemberSnapshot extends ProbeSource {
  name: string
  /** 子组没有叶子节点的探测记录，不作为改选目标。 */
  isGroup: boolean
}

export interface FailoverGroupSnapshot {
  name: string
  type: string
  /** 内核当前实际使用的节点（固定有效时即固定节点）。 */
  now: string
  fixed?: string
  testUrl?: string
  members: readonly FailoverMemberSnapshot[]
}

export interface FailoverContext {
  /** 引擎当前固定在该组的节点，用来区分「引擎固定」与「用户固定」。 */
  ownPin: string | undefined
  /** 仍在隔离期内的节点。 */
  quarantined: ReadonlySet<string>
  nowMs: number
}

export type FailoverSkipReason = 'not-url-test' | 'no-current-leaf' | 'user-pin' | 'no-candidate'

export type FailoverDecision =
  | { kind: 'switch'; badLeaf: string; target: string; targetDelay: number }
  | { kind: 'skip'; reason: FailoverSkipReason; badLeaf?: string }

function pickCandidate(
  group: FailoverGroupSnapshot,
  badLeaf: string,
  ctx: FailoverContext
): { name: string; delay: number } | undefined {
  let best: { name: string; delay: number } | undefined
  for (const member of group.members) {
    if (member.isGroup || member.name === badLeaf || ctx.quarantined.has(member.name)) {
      continue
    }
    const verdict = judgeProxyForUrl(member, group.testUrl, ctx.nowMs)
    // 时间戳无法解析时按过期处理（取反比较使 NaN 落入过期分支）。
    if (
      verdict.kind !== 'ok' ||
      !(ctx.nowMs - Date.parse(verdict.sampledAt) <= CANDIDATE_MAX_SAMPLE_AGE_MS)
    ) {
      continue
    }
    if (!best || verdict.delay < best.delay) {
      best = { name: member.name, delay: verdict.delay }
    }
  }
  return best
}

/**
 * 只改选 url-test 组：内核当前使用的节点视为失败节点；
 * 用户固定且内核正在遵循的节点不动，引擎自己的固定可以再次改选。
 */
export function planFailover(group: FailoverGroupSnapshot, ctx: FailoverContext): FailoverDecision {
  if (!isUrlTestGroupType(group.type)) {
    return { kind: 'skip', reason: 'not-url-test' }
  }
  const badLeaf = group.now
  if (!group.members.some((member) => !member.isGroup && member.name === badLeaf)) {
    return { kind: 'skip', reason: 'no-current-leaf' }
  }
  if (group.fixed && group.fixed === badLeaf && group.fixed !== ctx.ownPin) {
    return { kind: 'skip', reason: 'user-pin', badLeaf }
  }
  const candidate = pickCandidate(group, badLeaf, ctx)
  if (!candidate) {
    return { kind: 'skip', reason: 'no-candidate', badLeaf }
  }
  return { kind: 'switch', badLeaf, target: candidate.name, targetDelay: candidate.delay }
}
