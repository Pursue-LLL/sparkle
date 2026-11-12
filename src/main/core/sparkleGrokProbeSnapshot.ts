// [INPUT] 探测缓存 · 当前订阅节点
// [OUTPUT] syncGrokProbeSnapshot · getSparkleGrokProbeSnapshot
// [POS] 代理页展示用的内存快照：每次同步按「探测缓存 + 当前订阅」整体重建（403 / 超时的原因都在缓存记录里），
// 订阅里已经没有的节点不会留下来；经 IPC 读取时不回读磁盘、不重新解析订阅。

import {
  buildGrokProbeSnapshot,
  type GrokNodeProbeCache,
  type GrokProbeSnapshot,
  type GrokProxyRecord
} from './sparkleGrokProviderCore'

let probeSnapshot: GrokProbeSnapshot = {}

export function getSparkleGrokProbeSnapshot(): GrokProbeSnapshot {
  return { ...probeSnapshot }
}

export function syncGrokProbeSnapshot(
  proxies: readonly GrokProxyRecord[],
  cache: GrokNodeProbeCache
): void {
  probeSnapshot = buildGrokProbeSnapshot(proxies, cache)
}
