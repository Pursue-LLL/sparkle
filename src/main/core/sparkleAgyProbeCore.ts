// [INPUT] 待巡检节点 · 已有缓存 · 依赖注入（单点探测 / 时钟）
// [OUTPUT] runAgyAudit · AgyAuditResult
// [POS] agy 巡检状态机（纯编排，无 I/O）：决定哪些节点被测、何时中止、缓存如何演进。
// I/O（切组 + 调 magpie）由调用方注入，便于用假探针验证「不可用不下结论 / 致命错误中止 / 预算超时」等分支。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type { AgyNodeProbeRecord, AgyProbeVerdict, AgyProxyRecord } from './sparkleAgyProviderCore'

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
}

export interface AgyAuditResult {
  probed: number
  usable: number
  aborted: boolean
}

/**
 * 连续"全灭"轮次的退避：实测 Google 的拒绝是带冷却窗口的，
 * 越密集重试窗口越长，所以全灭后要主动拉长下一轮间隔（1×/2×/3× 封顶）。
 */
export function resolveAgyAuditBackoffMs(
  intervalMs: number,
  consecutiveEmptyRounds: number
): number {
  if (consecutiveEmptyRounds <= 0) {
    return 0
  }
  const multiplier = Math.min(consecutiveEmptyRounds, 3)
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

  for (const proxy of input.pending) {
    if (now() - startedAt > input.budgetMs) {
      return { probed, usable, aborted: true }
    }

    const name = String(proxy.name ?? '').trim()
    const outcome = await deps.probeNode(name)
    if (outcome.fatal) {
      return { probed, usable, aborted: true }
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
    }
  }

  return { probed, usable, aborted: false }
}
