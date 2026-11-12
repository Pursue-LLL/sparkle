// [INPUT] 探测缓存 · 当前订阅节点 · 每次真实 grok.com 请求的结论
// [OUTPUT] recordGrokAttempt · syncGrokProbeSnapshot · getSparkleGrokProbeSnapshot
// [POS] 代理页展示用的内存快照：缓存里的结论，加上本轮探测的最新结论（让 403 / 超时的原因立刻可见）；
// 只展示当前订阅里仍存在的节点，经 IPC 读取时不回读磁盘、不重新解析订阅。

import {
  buildGrokProbeSnapshot,
  grokProxyName,
  type GrokNodeProbeCache,
  type GrokProbeSample,
  type GrokProbeSnapshot,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'
import type { RoutedCheckResult } from './sparkleGrokRoutedCheck'

let probeSnapshot: GrokProbeSnapshot = {}

/** 本轮已探测结论；比磁盘缓存新时覆盖快照。 */
const lastAttempts = new Map<string, GrokProbeSample>()

export function getSparkleGrokProbeSnapshot(): GrokProbeSnapshot {
  return { ...probeSnapshot }
}

export function recordGrokAttempt(proxy: GrokProxyRecord, check: RoutedCheckResult): void {
  lastAttempts.set(grokProxyName(proxy), {
    state: check.ok ? 'usable' : 'failed',
    rttMs: check.ok ? check.rttMs : 0,
    checkedAt: Date.now(),
    status: check.status,
    ...(check.reason ? { reason: check.reason } : {})
  })
}

/** 用「磁盘缓存 + 本轮结论」重建快照；缓存命中但本轮没探测的节点保留上次真实结论。 */
export function syncGrokProbeSnapshot(
  proxies: readonly GrokProxyRecord[],
  cache: GrokNodeProbeCache
): void {
  const next = new Map<string, GrokProbeSample>(
    Object.entries(buildGrokProbeSnapshot(proxies, cache))
  )
  const subscribed = new Set(proxies.map(grokProxyName))
  for (const [name, attempt] of lastAttempts) {
    if (!subscribed.has(name)) {
      continue
    }
    const current = next.get(name)
    if (current && attempt.checkedAt < current.checkedAt) {
      continue
    }
    next.set(name, attempt)
  }
  probeSnapshot = Object.fromEntries(next)
}
