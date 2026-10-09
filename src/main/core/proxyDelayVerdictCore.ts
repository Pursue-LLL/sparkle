// [INPUT] mihomo 节点 history（按时间升序，delay≤0 表示该次探测失败）
// [OUTPUT] judgeProxyDelay · effectiveProxyDelay
// [POS] 延迟展示的单一判定规则（渲染进程经 @sparkle-core 引用）：
// 只有连续失败达到 FAILED_STREAK_TO_CONDEMN 次才判「超时」；失败不足此数且此前刚成功过，
// 判「波动」并沿用上次成功的延迟，避免一次抖动或批量探测的误报被当成节点已死。

export const FAILED_STREAK_TO_CONDEMN = 3
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

  const lastSuccessIndex = history.findLastIndex((entry) => entry.delay > 0)
  const failedStreak = history.length - 1 - lastSuccessIndex
  const lastSuccess = lastSuccessIndex >= 0 ? history[lastSuccessIndex] : undefined
  const successAgeMs = lastSuccess ? nowMs - Date.parse(lastSuccess.time) : Number.POSITIVE_INFINITY

  if (lastSuccess && failedStreak < FAILED_STREAK_TO_CONDEMN && successAgeMs <= FLAKY_MAX_SUCCESS_AGE_MS) {
    return { kind: 'flaky', delay: lastSuccess.delay, sampledAt: lastSuccess.time, failedAt: last.time }
  }
  return { kind: 'failed', sampledAt: last.time }
}

/** 兼容原有约定：>0 延迟 · 0 超时 · -1 未测。 */
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
