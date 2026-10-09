// [INPUT] mihomo provider 节点（history / extra[url].history）
// [OUTPUT] collectNodeDelays · hasSameNodeOrder · shouldAdoptLatencyOrder
// [POS] 把 mihomo 探测历史折算成「节点名 → 延迟」，供 sparkle-fast 段内按延迟排序。
// 纯函数模块，便于单测。

import type { NodeDelayMap } from './sparkleFastProviderCore'

/** 取最近若干次成功探测的中位数，抑制单次抖动。 */
const DELAY_SAMPLE_WINDOW = 5

interface ProviderNodeProbe {
  name: string
  alive: boolean
  history?: Array<{ delay: number }>
  extra?: Record<string, { alive: boolean; history?: Array<{ delay: number }> } | undefined>
}

function medianOfRecentSuccess(history: Array<{ delay: number }> | undefined): number | undefined {
  const recent = (history ?? [])
    .slice(-DELAY_SAMPLE_WINDOW)
    .map((entry) => entry.delay)
    .filter((delay) => delay > 0)
  if (recent.length === 0) {
    return undefined
  }
  const sorted = [...recent].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * 优先使用 `自动选择` 自身探测目标（Gemini）的历史，缺失时退回 provider 默认探测历史。
 * 不存活或没有成功样本的节点不入表（排序时垫在段尾）。
 */
export function collectNodeDelays(
  proxies: readonly ProviderNodeProbe[],
  preferredUrl: string
): NodeDelayMap {
  const delays = new Map<string, number>()
  for (const proxy of proxies) {
    const preferred = proxy.extra?.[preferredUrl]
    const alive = preferred ? preferred.alive : proxy.alive
    if (!alive) {
      continue
    }
    const delay = medianOfRecentSuccess(preferred?.history) ?? medianOfRecentSuccess(proxy.history)
    if (delay !== undefined) {
      delays.set(proxy.name, delay)
    }
  }
  return delays
}

export function hasSameNodeOrder(
  before: ReadonlyArray<{ name?: unknown }>,
  after: ReadonlyArray<{ name?: unknown }>
): boolean {
  return (
    before.length === after.length &&
    before.every((proxy, index) => String(proxy.name) === String(after[index].name))
  )
}

/** 周期重排时，新首选节点必须明显更快才换，避免延迟抖动让首选来回变。 */
const ADOPT_MIN_GAIN_MS = 50
const ADOPT_MIN_GAIN_RATIO = 0.3

/**
 * 当前首选节点已无样本（挂了/未测）时必须换；否则仅当新首选相对当前首选
 * 至少快 {@link ADOPT_MIN_GAIN_MS} 毫秒且快 {@link ADOPT_MIN_GAIN_RATIO} 以上才换。
 */
export function shouldAdoptLatencyOrder(
  currentFirst: string | undefined,
  nextFirst: string | undefined,
  delays: NodeDelayMap
): boolean {
  if (!nextFirst || currentFirst === nextFirst) {
    return false
  }
  const currentDelay = currentFirst === undefined ? undefined : delays.get(currentFirst)
  const nextDelay = delays.get(nextFirst)
  if (currentDelay === undefined) {
    return true
  }
  if (nextDelay === undefined) {
    return false
  }
  const gain = currentDelay - nextDelay
  return gain >= ADOPT_MIN_GAIN_MS && gain >= currentDelay * ADOPT_MIN_GAIN_RATIO
}
