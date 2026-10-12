// [INPUT] mihomo 节点在某个探测地址上的 history（按时间升序，delay≤0 表示该次探测失败）
// [OUTPUT] judgeProxyDelay · judgeProxyForUrl · judgeOtherProbeUrls · effectiveProxyDelay
// [POS] 延迟展示的单一判定规则（渲染进程经 @sparkle-core 引用）：
// 近期样本窗口里一次都没成功才判「超时」；最近一次失败但窗口内成功过，判「不稳定」并沿用上次成功的延迟，
// 避免时好时坏的节点或批量探测的误报被当成节点已死。

import {
  isSameProbeUrl,
  resolveProbeHistory,
  type ProbeSource
} from './proxyProbeHistoryCore'

/** 上次成功距今超过此时长，不再沿用其延迟。 */
export const FLAKY_MAX_SUCCESS_AGE_MS = 30 * 60 * 1000

export type ProxyDelayVerdict =
  | { kind: 'untested' }
  | { kind: 'ok'; delay: number; sampledAt: string }
  | { kind: 'flaky'; delay: number; sampledAt: string; failedAt: string }
  | { kind: 'failed'; sampledAt: string }

export function judgeProxyDelay(
  history: readonly ControllerProxiesHistory[] | undefined,
  nowMs: number = Date.now()
): ProxyDelayVerdict {
  const last = history?.at(-1)
  if (!history || !last) {
    return { kind: 'untested' }
  }
  if (last.delay > 0) {
    return { kind: 'ok', delay: last.delay, sampledAt: last.time }
  }

  const lastSuccess = history.findLast((entry) => entry.delay > 0)
  const successAgeMs = lastSuccess ? nowMs - Date.parse(lastSuccess.time) : Number.POSITIVE_INFINITY

  if (lastSuccess && successAgeMs <= FLAKY_MAX_SUCCESS_AGE_MS) {
    return { kind: 'flaky', delay: lastSuccess.delay, sampledAt: lastSuccess.time, failedAt: last.time }
  }
  return { kind: 'failed', sampledAt: last.time }
}

/** 按组实际使用的探测地址取样本后判定；界面、托盘、复测共用此入口，保证各处结论一致。 */
export function judgeProxyForUrl(
  source: ProbeSource,
  probeUrl: string | undefined,
  nowMs?: number
): ProxyDelayVerdict {
  return judgeProxyDelay(resolveProbeHistory(source, probeUrl), nowMs)
}

export interface OtherProbeVerdict {
  url: string
  verdict: ProxyDelayVerdict
}

/** 节点在「组探测地址」之外的其它地址上的表现（已测过的），用来区分「只对该地址不通」与「整个节点不通」。 */
export function judgeOtherProbeUrls(
  source: ProbeSource,
  probeUrl: string | undefined,
  nowMs?: number
): OtherProbeVerdict[] {
  const seen: string[] = probeUrl ? [probeUrl] : []
  const others: OtherProbeVerdict[] = []
  for (const url of Object.keys(source.extra ?? {})) {
    if (seen.some((known) => isSameProbeUrl(known, url))) {
      continue
    }
    seen.push(url)
    const verdict = judgeProxyForUrl(source, url, nowMs)
    if (verdict.kind !== 'untested') {
      others.push({ url, verdict })
    }
  }
  return others
}

/** 折算成排序/展示用的数值：>0 延迟 · 0 超时 · -1 未测。 */
export function effectiveProxyDelay(verdict: ProxyDelayVerdict): number {
  switch (verdict.kind) {
    case 'ok':
    case 'flaky':
      return verdict.delay
    case 'failed':
      return 0
    case 'untested':
      return -1
  }
}
