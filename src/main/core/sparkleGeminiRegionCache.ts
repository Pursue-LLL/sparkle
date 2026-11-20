// [INPUT] dataDir()/sparkle-gemini-nodes.json ·
//         utils/atomicFile::writeFileAtomic (POS: 持久化状态的落盘原语) ·
//         utils/bestEffortLog::bestEffortLog (POS: 永不 reject 的日志包装) ·
//         utils/dirs::dataDir (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         sparkleGeminiProbeCore::GeminiRegionProbeRecord/GeminiRegionProbeCache (POS: Gemini 地区判定纯函数)
// [OUTPUT] ELIGIBLE_CACHE_TTL_MS · INELIGIBLE_CACHE_TTL_MS · loadSparkleGeminiRegionCache · saveSparkleGeminiRegionCache
// [POS] Gemini 地区判定缓存（节点指纹或节点名 → 地区码判定）：内存为准、写穿磁盘（原子写）。
// 合格记录满 ELIGIBLE_CACHE_TTL_MS、锁区记录满 INELIGIBLE_CACHE_TTL_MS 即失效，失效记录在每次读取时清掉；
// 文件缺失或损坏按空缓存处理（来自未来的时间戳按当前时刻算），落盘失败只丢失重启后的记忆、不改变本次运行的结论。

import { readFile } from 'fs/promises'
import path from 'path'
import { writeFileAtomic } from '../utils/atomicFile'
import { bestEffortLog } from '../utils/bestEffortLog'
import { dataDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import type { GeminiRegionProbeCache, GeminiRegionProbeRecord } from './sparkleGeminiProbeCore'

const CACHE_FILENAME = 'sparkle-gemini-nodes.json'
export const ELIGIBLE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const INELIGIBLE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

const writeLog = bestEffortLog(appendAppLog)

let memoryCache: Map<string, GeminiRegionProbeRecord> | null = null

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

function isRecordFresh(record: GeminiRegionProbeRecord, nowMs: number): boolean {
  const ttl = record.eligible ? ELIGIBLE_CACHE_TTL_MS : INELIGIBLE_CACHE_TTL_MS
  return nowMs - record.checkedAt < ttl
}

export async function loadSparkleGeminiRegionCache(
  nowMs: number = Date.now()
): Promise<Map<string, GeminiRegionProbeRecord>> {
  if (memoryCache) {
    for (const [key, val] of memoryCache.entries()) {
      if (!isRecordFresh(val, nowMs)) {
        memoryCache.delete(key)
      }
    }
    return memoryCache
  }
  try {
    const raw = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<
      string,
      GeminiRegionProbeRecord
    >
    const map = new Map<string, GeminiRegionProbeRecord>()
    for (const [key, val] of Object.entries(raw)) {
      if (
        val &&
        typeof val.eligible === 'boolean' &&
        typeof val.countryCode === 'string' &&
        typeof val.checkedAt === 'number' &&
        isRecordFresh(val, nowMs)
      ) {
        // 时钟回拨或文件损坏留下的「未来」时间戳按当前时刻算，否则记录永远不会过期、也等不到复验。
        map.set(key, {
          eligible: val.eligible,
          countryCode: val.countryCode,
          checkedAt: Math.min(val.checkedAt, nowMs)
        })
      }
    }
    memoryCache = map
    return map
  } catch {
    memoryCache = new Map()
    return memoryCache
  }
}

export async function saveSparkleGeminiRegionCache(cache: GeminiRegionProbeCache): Promise<void> {
  try {
    await writeFileAtomic(cacheFilePath(), JSON.stringify(Object.fromEntries(cache), null, 2))
  } catch (error) {
    await writeLog(
      `[SparkleGeminiProbe]: region cache not persisted: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}
