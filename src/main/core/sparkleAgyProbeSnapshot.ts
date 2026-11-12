// [INPUT] 探测缓存 · 当前订阅节点 · 每次真实 agy 请求的结论
// [OUTPUT] recordAgyAttempt · syncAgyProbeSnapshot · getSparkleAgyProbeSnapshot
// [POS] 代理页展示用的内存快照：缓存里的可用 / 已拒绝结论，加上最近一次失败的探测，
// 经 IPC 读取时不回读磁盘、不重新解析订阅。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  buildAgyProbeSnapshot,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'

/** 代理页展示用的内存快照：只包含「最近一次真实 agy 请求成功」的节点，避免回读磁盘/重建订阅。 */
const agyProbeSnapshot = new Map<string, AgyProbeSample>()

/** 最近一次真实探测的结论（含失败），用于把"未测"与"探测失败"区分开。 */
const agyLastAttempts = new Map<
  string,
  { state: 'usable' | 'unusable' | 'failed'; reason?: string; checkedAt: number }
>()

export function recordAgyAttempt(
  node: string,
  state: 'usable' | 'unusable' | 'failed',
  reason?: string
): void {
  const name = node.trim()
  if (!name) {
    return
  }
  agyLastAttempts.set(name, { state, reason, checkedAt: Date.now() })
}

export function getSparkleAgyProbeSnapshot(): AgyProbeSnapshot {
  return Object.fromEntries(agyProbeSnapshot)
}

export function syncAgyProbeSnapshot(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>,
  proxies: readonly AgyProxyRecord[]
): void {
  const next = new Map<string, AgyProbeSample>()

  for (const [name, sample] of Object.entries(buildAgyProbeSnapshot(proxies, cache))) {
    next.set(name, { ...sample, state: 'usable' })
  }

  // 已确认锁区（400 location）的节点：有记录就展示真实结论，而不是笼统的"未测"。
  for (const proxy of proxies) {
    const name = String(proxy.name ?? '').trim()
    if (!name) {
      continue
    }
    const record = cache.get(computeProxyNodeFingerprint(proxy))
    if (!record || record.usable) {
      continue
    }
    const current = next.get(name)
    if (!current || record.checkedAt >= current.checkedAt) {
      next.set(name, {
        rttMs: record.rttMs,
        checkedAt: record.checkedAt,
        state: 'unusable',
        reason: '地区不支持'
      })
    }
  }

  // 最近一次探测失败（超时/网络/CLI 不可用）：比已有样本新才覆盖。
  for (const [name, attempt] of agyLastAttempts) {
    if (attempt.state === 'usable') {
      continue
    }
    const current = next.get(name)
    if (current && attempt.checkedAt < current.checkedAt) {
      continue
    }
    next.set(name, {
      rttMs: 0,
      checkedAt: attempt.checkedAt,
      state: attempt.state,
      reason: attempt.reason
    })
  }

  agyProbeSnapshot.clear()
  for (const [name, sample] of next) {
    agyProbeSnapshot.set(name, sample)
  }
}
