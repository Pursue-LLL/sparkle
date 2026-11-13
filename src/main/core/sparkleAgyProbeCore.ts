// [INPUT] 待巡检节点 · 已有缓存 · 依赖注入（单点探测 / 时钟） ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyProviderCore::agyProxyName/AgyNodeProbeRecord/AgyProbeVerdict/AgyProxyRecord (POS: agy provider 与分组配置)
// [OUTPUT] runAgyAudit · shouldRepairAgyPin · resolveAgyAuditBackoffMs · AgyAuditResult
// [POS] agy 巡检状态机（纯编排，无 I/O）：决定哪些节点被测、何时中止、缓存如何演进。
// I/O（切组 + 调 magpie）由调用方注入，便于用假探针验证「不可用不下结论 / 致命错误中止 / 预算超时」等分支。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  agyProxyName,
  type AgyNodeProbeRecord,
  type AgyProbeVerdict,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'

export interface AgyAuditOutcome {
  verdict: AgyProbeVerdict
  rttMs: number
  /** magpie 侧不可用（网关未启动 / 模型缺失），继续巡检没有意义。 */
  fatal: boolean
}

export interface AgyAuditDeps {
  probeNode: (nodeName: string) => Promise<AgyAuditOutcome>
  now?: () => number
}

export interface AgyAuditInput {
  pending: readonly AgyProxyRecord[]
  cache: Map<string, AgyNodeProbeRecord>
  /** 整轮巡检预算；超时后剩余节点留待下一轮。 */
  budgetMs: number
  /** 修复扫描：拿到第一个 usable 就停，避免为了补全面把用户流量在更多候选节点之间来回拖。 */
  stopOnUsable?: boolean
  /** 本轮尝试过的节点（含超时这种不下结论的），供下一轮排序跳过、保证进度。 */
  attempted?: Map<string, number>
}

export interface AgyAuditResult {
  probed: number
  usable: number
  aborted: boolean
  /** 本轮第一个判定可用的节点名；修复扫描用它作为最终选择。 */
  usableNode: string | null
}

/** pin 连续超时的容忍轮数：一次超时可能只是模型排队 / 上游整体变慢，连续两轮才认为出口不能用。 */
export const AGY_PIN_UNKNOWN_STREAK_LIMIT = 2

/**
 * pin 就地复测之后的处置：
 * - 明确 400 → 立即修复（此前已同节点复测一次排除账号轮转）；
 * - 没有 pin（组未生成 / 节点已从候选池消失）→ 立即修复；
 * - 超时 → 先累计轮次，连续 N 轮才修复，避免上游整体变慢时每 3 分钟把生产出口拖去扫一遍；
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
      return { probed, usable, aborted: true, usableNode }
    }

    const name = agyProxyName(proxy)
    input.attempted?.set(computeProxyNodeFingerprint(proxy), now())
    const outcome = await deps.probeNode(name)
    if (outcome.fatal) {
      return { probed, usable, aborted: true, usableNode }
    }
    // 限流 / 超时等无法定性的结果不写缓存，避免把健康节点误判成不可用。
    if (outcome.verdict === 'unknown') {
      continue
    }

    input.cache.set(computeProxyNodeFingerprint(proxy), {
      usable: outcome.verdict === 'usable',
      rttMs: outcome.rttMs,
      checkedAt: now()
    })
    probed += 1
    if (outcome.verdict === 'usable') {
      usable += 1
      usableNode = name
      if (input.stopOnUsable) {
        break
      }
    }
  }

  return { probed, usable, aborted: false, usableNode }
}
