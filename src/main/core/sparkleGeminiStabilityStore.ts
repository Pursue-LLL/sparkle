// [INPUT] dataDir()/sparkle-gemini-stability.json ·
//         utils/atomicFile::writeFileAtomic (POS: 持久化状态的落盘原语) ·
//         utils/bestEffortLog::bestEffortLog (POS: 永不 reject 的日志包装) ·
//         utils/dirs::dataDir (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         sparkleGeminiStabilityCore::canRecordPenalty/isNodeStable/parseStabilityLedger/recordSample/PENALTY_BURST_LIMIT/PENALTY_BURST_WINDOW_MS/GeminiStabilityEntry/GeminiStabilityLedger (POS: Gemini 节点稳定度台账的纯规则)
// [OUTPUT] loadGeminiStabilityLedger · noteGeminiRegionSample
// [POS] Gemini 节点稳定度台账（`sparkle-gemini-stability.json`，节点名 → 判定次数与最近封锁时刻）的持久化与记账。
// 内存为准、原子写穿磁盘；文件缺失按空台账，损坏按空台账并记一行日志（失败开放：回到「没有历史」，不比没有台账更差）；
// 落盘失败只丢失重启后的记忆。稳定度升降与被限流跳过的罚分各记一行日志，事后能查到队首为什么换。

import { readFile } from 'fs/promises'
import path from 'path'
import { writeFileAtomic } from '../utils/atomicFile'
import { bestEffortLog } from '../utils/bestEffortLog'
import { dataDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import {
  canRecordPenalty,
  isNodeStable,
  parseStabilityLedger,
  PENALTY_BURST_LIMIT,
  PENALTY_BURST_WINDOW_MS,
  recordSample,
  type GeminiStabilityEntry,
  type GeminiStabilityLedger
} from './sparkleGeminiStabilityCore'

const LEDGER_FILENAME = 'sparkle-gemini-stability.json'

const writeLog = bestEffortLog(appendAppLog)

/** 首次访问时从磁盘载入，之后只改内存。 */
let ledgerPromise: Promise<Map<string, GeminiStabilityEntry>> | undefined

/** 最近入账的封锁罚分时刻，只用来限流。 */
let recentPenaltyAtMs: number[] = []

function ledgerFilePath(): string {
  return path.join(dataDir(), LEDGER_FILENAME)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function readLedger(): Promise<Map<string, GeminiStabilityEntry>> {
  try {
    return parseStabilityLedger(JSON.parse(await readFile(ledgerFilePath(), 'utf8')), Date.now())
  } catch (error) {
    if (!isMissingFile(error)) {
      await writeLog(
        `[SparkleGeminiStability]: ledger unreadable, starting empty: ${describeError(error)}\n`
      )
    }
    return new Map()
  }
}

function loadMutableLedger(): Promise<Map<string, GeminiStabilityEntry>> {
  ledgerPromise ??= readLedger()
  return ledgerPromise
}

/** 台账的只读视图；调用方拿到的是同一份内存，之后的记账立即可见。 */
export function loadGeminiStabilityLedger(): Promise<GeminiStabilityLedger> {
  return loadMutableLedger()
}

async function persist(ledger: ReadonlyMap<string, GeminiStabilityEntry>): Promise<void> {
  try {
    await writeFileAtomic(ledgerFilePath(), JSON.stringify(Object.fromEntries(ledger)))
  } catch (error) {
    await writeLog(`[SparkleGeminiStability]: ledger not persisted: ${describeError(error)}\n`)
  }
}

/** 封锁罚分在窗口内用完额度就不再入账；返回是否放行。 */
function admitPenalty(nowMs: number): boolean {
  recentPenaltyAtMs = recentPenaltyAtMs.filter((at) => nowMs - at < PENALTY_BURST_WINDOW_MS)
  if (!canRecordPenalty(recentPenaltyAtMs, nowMs)) {
    return false
  }
  recentPenaltyAtMs.push(nowMs)
  return true
}

/** 记入一次明确判定（合格或封锁）；网络超时之类没有结论的探测不该调用它。 */
export async function noteGeminiRegionSample(
  nodeName: string,
  bad: boolean,
  nowMs: number = Date.now()
): Promise<void> {
  const ledger = await loadMutableLedger()
  if (bad && !admitPenalty(nowMs)) {
    await writeLog(
      `[SparkleGeminiStability]: skipped penalty for "${nodeName}": ${PENALTY_BURST_LIMIT} penalties within ${PENALTY_BURST_WINDOW_MS / 60_000} minutes, treating it as a systemic event\n`
    )
    return
  }
  const before = ledger.get(nodeName)
  const after = recordSample(before, bad, nowMs)
  ledger.set(nodeName, after)
  const wasStable = isNodeStable(before, nowMs)
  const isStable = isNodeStable(after, nowMs)
  if (wasStable !== isStable) {
    await writeLog(
      `[SparkleGeminiStability]: node "${nodeName}" ${isStable ? 'became stable' : 'lost stable status'} (samples=${after.samples})\n`
    )
  }
  await persist(ledger)
}
