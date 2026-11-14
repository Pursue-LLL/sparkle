// [INPUT] dataDir()/sparkle-node-quality.json ·
//         sparkleNodeQualityCore::SINK_TTL_MS (POS: 节点质量闸门纯决策层)
// [OUTPUT] loadSunkNodeNames · markNodesSunk
// [POS] 因下载吞吐实测判劣而「沉底」的节点记录（节点名 → 沉底时刻），满 SINK_TTL_MS 自动失效。
// 内存为准、写穿到磁盘：重启后沿用，避免刚被判劣的节点一重启又被钉回去。
// 落盘失败只丢失重启后的记忆，不影响本次运行；文件损坏按空记录处理（等同放行，不比没有这道闸更差）。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { dataDir } from '../utils/dirs'
import { SINK_TTL_MS } from './sparkleNodeQualityCore'

const CACHE_FILENAME = 'sparkle-node-quality.json'

/** 节点名 → 沉底时刻；首次访问时从磁盘载入，之后只改内存。 */
let sunkAtByName: Promise<Map<string, number>> | undefined

/** 写盘串行化：重叠的 writeFile 会交错出损坏的 JSON；排队后最后一次快照即最终内容。 */
let persisting: Promise<void> = Promise.resolve()

function cacheFilePath(): string {
  return path.join(dataDir(), CACHE_FILENAME)
}

async function readRecords(): Promise<Map<string, number>> {
  try {
    const parsed = JSON.parse(await readFile(cacheFilePath(), 'utf8')) as Record<string, unknown>
    const records = new Map<string, number>()
    for (const [name, sunkAtMs] of Object.entries(parsed)) {
      if (typeof sunkAtMs === 'number' && Number.isFinite(sunkAtMs)) {
        records.set(name, sunkAtMs)
      }
    }
    return records
  } catch {
    return new Map()
  }
}

function loadRecords(): Promise<Map<string, number>> {
  sunkAtByName ??= readRecords()
  return sunkAtByName
}

/**
 * 记录只在一个 TTL 内有效。时间戳超前当前时刻一个 TTL 以上说明写入时系统时钟是错的
 * （例如手动调快日期后又改回），否则这条记录要等到真实时间追上它才会过期。
 * 超前几毫秒是正常的：并发读取方的时钟读数可能比刚写入的记录早一点，不能当作作废。
 */
function dropExpired(records: Map<string, number>, nowMs: number): void {
  for (const [name, sunkAtMs] of records) {
    if (Math.abs(nowMs - sunkAtMs) >= SINK_TTL_MS) {
      records.delete(name)
    }
  }
}

export async function loadSunkNodeNames(nowMs: number = Date.now()): Promise<ReadonlySet<string>> {
  const records = await loadRecords()
  dropExpired(records, nowMs)
  return new Set(records.keys())
}

/** 记下这些节点被判劣；已在册的节点重新计时。 */
export async function markNodesSunk(
  names: readonly string[],
  nowMs: number = Date.now()
): Promise<void> {
  if (names.length === 0) {
    return
  }
  const records = await loadRecords()
  for (const name of names) {
    records.set(name, nowMs)
  }
  dropExpired(records, nowMs)
  const snapshot = JSON.stringify(Object.fromEntries(records))
  persisting = persisting
    .then(() => writeFile(cacheFilePath(), snapshot, 'utf8'))
    .catch(() => undefined)
  await persisting
}
