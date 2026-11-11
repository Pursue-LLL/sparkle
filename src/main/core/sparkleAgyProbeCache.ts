// [INPUT] dataDir()/sparkle-agy-nodes.json
// [OUTPUT] loadSparkleAgyProbeCache · saveSparkleAgyProbeCache
// [POS] agy 节点探测缓存的唯一读写入口：TTL 决定「多久之后必须重测」，与探测/巡检编排解耦。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'
import type { AgyNodeProbeRecord } from './sparkleAgyProviderCore'

const CACHE_FILENAME = 'sparkle-agy-nodes.json'

const USABLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
/**
 * 不可用结论只保持 30 分钟：实测这种 400 是**时变**的（同节点 20 分钟内 400 → 200），
 * 缓存太久会让节点被误判封死半天。
 */
const UNUSABLE_CACHE_TTL_MS = 30 * 60 * 1000

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function isCacheRecordFresh(record: AgyNodeProbeRecord, nowMs: number): boolean {
  const ttl = record.usable ? USABLE_CACHE_TTL_MS : UNUSABLE_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleAgyProbeCache(
  nowMs: number = Date.now()
): Promise<Map<string, AgyNodeProbeRecord>> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      AgyNodeProbeRecord
    >
    const map = new Map<string, AgyNodeProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.usable === 'boolean' &&
        typeof val.rttMs === 'number' &&
        typeof val.checkedAt === 'number' &&
        isCacheRecordFresh(val, nowMs)
      ) {
        map.set(key, val)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

export async function saveSparkleAgyProbeCache(
  cache: ReadonlyMap<string, AgyNodeProbeRecord>
): Promise<void> {
  const serialized = Object.fromEntries(cache.entries())
  await writeFile(cacheFilePath(), JSON.stringify(serialized, null, 2), 'utf8')
}
