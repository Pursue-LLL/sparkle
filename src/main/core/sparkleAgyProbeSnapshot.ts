// [INPUT] 探测缓存 · 当前订阅节点 · 每次真实 agy 请求的结论 ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         sparkleAgyProviderCore::agyProxyName/buildAgyProbeSnapshot/AgyNodeProbeRecord/AgyProxyRecord (POS: agy provider 与分组配置)
// [OUTPUT] recordAgyAttempt · syncAgyProbeSnapshot · getSparkleAgyProbeSnapshot
// [POS] 代理页展示用的内存快照：缓存里的可用 / 已拒绝结论，加上最近一次失败的探测，
// 经 IPC 读取时不回读磁盘、不重新解析订阅。

import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import {
  agyProxyName,
  buildAgyProbeSnapshot,
  type AgyNodeProbeRecord,
  type AgyProxyRecord
} from './sparkleAgyProviderCore'

/** 代理页展示用的内存快照：每次同步按当前订阅整体重建，订阅里已经没有的节点不会留下来。 */
let probeSnapshot: AgyProbeSnapshot = {}

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
  agyLastAttempts.set(node, { state, reason, checkedAt: Date.now() })
}

export function getSparkleAgyProbeSnapshot(): AgyProbeSnapshot {
  return { ...probeSnapshot }
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
  const subscribed = new Set<string>()
  for (const proxy of proxies) {
    const name = agyProxyName(proxy)
    if (!name) {
      continue
    }
    subscribed.add(name)
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

  // 最近一次探测失败（超时/网络/CLI 不可用）：比已有样本新才覆盖；已不在订阅里的节点不展示。
  for (const [name, attempt] of agyLastAttempts) {
    if (attempt.state === 'usable' || !subscribed.has(name)) {
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

  probeSnapshot = Object.fromEntries(next)
}
