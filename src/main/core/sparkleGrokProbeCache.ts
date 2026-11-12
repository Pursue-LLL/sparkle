// [INPUT] 数据目录里的 sparkle-grok-nodes.json · 每次真实 grok.com 请求的结论
// [OUTPUT] loadSparkleGrokProbeCache · saveSparkleGrokProbeCache · recordRouted · recordRoutedFailure
// [POS] grok 探测缓存的磁盘读写与结论写入：读取时整条丢弃字段不合法的记录；
// 代理页的展示快照由缓存整体重建，所以每次探测只需要把结论写进缓存。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import type {
  GrokNodeProbeCache,
  GrokNodeProbeRecord,
  GrokProxyRecord
} from './sparkleGrokProviderCore'
import type { RoutedCheckResult } from './sparkleGrokRoutedCheck'

const CACHE_FILENAME = 'sparkle-grok-nodes.json'

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

export async function loadSparkleGrokProbeCache(): Promise<Map<string, GrokNodeProbeRecord>> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      GrokNodeProbeRecord
    >
    const map = new Map<string, GrokNodeProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.alive === 'boolean' &&
        typeof val.rttMs === 'number' &&
        typeof val.checkedAt === 'number'
      ) {
        map.set(key, val)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

export async function saveSparkleGrokProbeCache(cache: GrokNodeProbeCache): Promise<void> {
  await writeFile(
    cacheFilePath(),
    JSON.stringify(Object.fromEntries(cache.entries()), null, 2),
    'utf8'
  )
}

export function recordRouted(
  cache: Map<string, GrokNodeProbeRecord>,
  proxy: GrokProxyRecord,
  check: RoutedCheckResult
): void {
  cache.set(computeProxyNodeFingerprint(proxy), {
    alive: true,
    rttMs: check.rttMs,
    checkedAt: Date.now(),
    status: check.status
  })
}

export function recordRoutedFailure(
  cache: Map<string, GrokNodeProbeRecord>,
  proxy: GrokProxyRecord,
  check: RoutedCheckResult
): void {
  cache.set(computeProxyNodeFingerprint(proxy), {
    alive: false,
    rttMs: 0,
    checkedAt: Date.now(),
    status: check.status,
    ...(check.reason ? { reason: check.reason } : {})
  })
}
