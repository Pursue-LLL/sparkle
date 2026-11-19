// [INPUT] 一轮巡检上下文 · agy 组操作 · 探测缓存 ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyEvidenceCore::AgyProductionVerdict (POS: agy 出口生产证据) ·
//         sparkleAgyGroupControl::convergeAgyProvider/probeSingleNode (POS: agy 组操作) ·
//         sparkleAgyProbeCache::saveSparkleAgyProbeCache (POS: agy 探测缓存读写) ·
//         sparkleAgyProbeCore::resolveProbeTimeoutMs/AgyAuditOutcome (POS: agy 巡检状态机) ·
//         sparkleAgyProbeSnapshot::syncAgyProbeSnapshot (POS: agy 展示快照) ·
//         sparkleAgyProviderCore::AgyNodeProbeRecord/AgyProbeVerdict/AgyProxyRecord (POS: agy provider 与分组配置) ·
//         sparkleAgyReputation::flagAgyNode (POS: agy 节点被拒记忆) ·
//         sparkleAgyRound::selectPin/AgyRound (POS: agy 一轮巡检上下文) ·
//         sparkleAgyState::clearAgyRepairBackoff (POS: agy 巡检状态持久化) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] checkPin · keepPin · PinCheck
// [POS] pin 就地复测与保留：不切组、不关连接、不影响正在进行的会话。
// 复测结论写入探测缓存与被拒记忆；复测只是超时、而生产流量刚证明这个出口没问题时，这一轮不计入连续超时。

import { appendAppLog } from '../utils/log'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { AgyProductionVerdict } from './sparkleAgyEvidenceCore'
import { convergeAgyProvider, probeSingleNode } from './sparkleAgyGroupControl'
import { saveSparkleAgyProbeCache } from './sparkleAgyProbeCache'
import { resolveProbeTimeoutMs, type AgyAuditOutcome } from './sparkleAgyProbeCore'
import { syncAgyProbeSnapshot } from './sparkleAgyProbeSnapshot'
import type { AgyProbeVerdict, AgyProxyRecord } from './sparkleAgyProviderCore'
import { flagAgyNode } from './sparkleAgyReputation'
import { selectPin, type AgyRound } from './sparkleAgyRound'
import { clearAgyRepairBackoff } from './sparkleAgyState'

/**
 * pin 复测的探测超时：agy CLI 冷启动 + 模型排队可能超过 30s，给足 90s。
 * 慢 ≠ 坏；超时只记 unknown，不把节点判死。
 */
const PIN_PROBE_TIMEOUT_MS = 90_000

/**
 * pin 复测结论：
 * - `verdict`：探测出结论；null 表示没有 pin 可测；
 * - `fatal`：agy CLI 不可用，继续巡检没有意义，本轮放弃；
 * - `no-time`：离截止时间太近，没发探测（也就没有结论），留给下一次。
 */
export type PinCheck =
  | { kind: 'verdict'; verdict: AgyProbeVerdict | null }
  | { kind: 'fatal' }
  | { kind: 'no-time' }

/** 离截止时间太近、发不出一次有意义的探测时返回 undefined。 */
async function probePinOnce(
  pinName: string,
  deadlineAtMs: number
): Promise<AgyAuditOutcome | undefined> {
  const timeoutMs = resolveProbeTimeoutMs(PIN_PROBE_TIMEOUT_MS, deadlineAtMs, Date.now())
  return timeoutMs === undefined ? undefined : probeSingleNode(pinName, timeoutMs)
}

/** 400 可能是账号轮转造成的：同节点再确认一次，两次都 400 才认定节点被拒。 */
async function probePin(
  pinName: string,
  deadlineAtMs: number
): Promise<AgyAuditOutcome | undefined> {
  const first = await probePinOnce(pinName, deadlineAtMs)
  return first?.verdict === 'unusable' ? probePinOnce(pinName, deadlineAtMs) : first
}

/** 写入 pin 的复测结论（被拒的同时记入被拒记忆）；返回结论相对缓存里的旧记录是否变了。 */
function recordPinOutcome(
  round: AgyRound,
  proxy: AgyProxyRecord,
  outcome: AgyAuditOutcome
): boolean {
  const { cache, state } = round
  const fingerprint = computeProxyNodeFingerprint(proxy)
  const previous = cache.get(fingerprint)
  const usable = outcome.verdict === 'usable'
  cache.set(fingerprint, {
    usable,
    rttMs: outcome.rttMs,
    checkedAt: Date.now()
  })
  if (outcome.verdict === 'unusable') {
    flagAgyNode(state.flags, fingerprint, Date.now())
  }
  return !previous || previous.usable !== usable
}

/**
 * pin 就地复测；超时不复测，按轮次累计（上游整体变慢时不能反复把生产出口拖去扫一遍）。
 * 否决权只给含糊的超时：生产流量刚在这个出口上正常工作（`healthy`）时，探测超时只说明探测没跑通，累计清零；
 * 明确的 400 是 Google 对这个出口的直接回答，生产证据不能推翻它。
 */
export async function checkPin(
  round: AgyRound,
  production: AgyProductionVerdict,
  deadlineAtMs: number
): Promise<PinCheck> {
  const { cache, proxies, pinName, pinProxy, state } = round
  if (!pinName || !pinProxy) {
    state.pinUnknownStreak = 0
    return { kind: 'verdict', verdict: null }
  }

  const outcome = await probePin(pinName, deadlineAtMs)
  if (!outcome) {
    return { kind: 'no-time' }
  }
  if (outcome.fatal) {
    return { kind: 'fatal' }
  }
  if (outcome.verdict !== 'unknown') {
    const changed = recordPinOutcome(round, pinProxy, outcome)
    if (changed) {
      await saveSparkleAgyProbeCache(cache)
    }
  }
  syncAgyProbeSnapshot(cache, proxies)
  state.pinUnknownStreak =
    outcome.verdict === 'unknown' && production !== 'healthy' ? state.pinUnknownStreak + 1 : 0
  return { kind: 'verdict', verdict: outcome.verdict }
}

/**
 * pin 没被判不可用：按缓存收敛 provider；只有实测可用才算恢复。
 * 仅超时一轮就清掉退避的话，紧随其后的 400 会绕过退避立刻再扫一遍。
 */
export async function keepPin(round: AgyRound, pinVerdict: AgyProbeVerdict | null): Promise<void> {
  const { state } = round
  const ordered = await convergeAgyProvider(
    round.proxies,
    round.regionPriority,
    round.cache,
    state.flags
  )
  await selectPin(round, ordered, round.pinName)
  if (pinVerdict !== 'usable') {
    return
  }
  clearAgyRepairBackoff(state)
  if (state.phase !== 'healthy') {
    await appendAppLog(
      `[SparkleAgyProbe]: pin ${round.pinName ?? 'n/a'} healthy again, pool=${ordered.length}\n`
    )
    state.phase = 'healthy'
  }
}
