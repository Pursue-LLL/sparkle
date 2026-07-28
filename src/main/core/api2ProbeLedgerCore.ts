// [INPUT] fs/promises · api2ProbeLedgerRowCore · providerDelayHistoryDisplayCore · providerDelayHistoryFromLedgerCore
// [OUTPUT] appendApi2ProbeLedgerRow · readApi2ProbeLedgerSince · readRecentSessionNudgeAnchorsForNode · readProviderDelayHistoryFromLedger · readLatencyTruthSummaryForNode
// [POS] api2 探针 ledger 持久化与按节点读取 session_nudge 锚点（P9n UI 柱图 SSOT）。

import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { homeDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import {
  readApi2ProbeLedgerRowsSince,
  type Api2ProbeLedgerRow,
  type Api2ProbeScope
} from './api2ProbeLedgerRowCore'
import {
  readSessionNudgeAnchorsFromLedger,
  type SessionNudgeDelayAnchor,
} from './providerDelayHistoryDisplayCore'
import {
  ledgerRowsToProviderDelayHistory,
  LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS,
  type ProviderDelayHistoryFromLedgerEntry,
} from './providerDelayHistoryFromLedgerCore'
import {
  ledgerRowsToLatencyTruthSummary,
  type LatencyTruthSummary,
} from './latencyTruthFromLedgerCore'

export {
  ledgerRowsToLatencyTruthSummary,
  isVpsBodyBenchmarkLedgerRow,
  isMacFullPathLatencyLedgerRow,
  computeDelayP50,
  VPS_BODY_BENCHMARK_METHOD,
  MAC_FULL_PATH_LATENCY_METHOD,
  type LatencyTruthSummary,
} from './latencyTruthFromLedgerCore'

export {
  ledgerRowsToProviderDelayHistory,
  LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS,
  type ProviderDelayHistoryFromLedgerEntry,
} from './providerDelayHistoryFromLedgerCore'

export {
  ledgerRowToBenchmarkSample,
  readApi2ProbeLedgerRowsSince,
  type Api2ProbeLedgerRow,
  type Api2ProbeMethod,
  type Api2ProbeScope
} from './api2ProbeLedgerRowCore'

export const API2_PROBE_LEDGER_FILENAME = 'api2-probe-ledger.jsonl'
export const API2_PROBE_LEDGER_RETENTION_MS = 24 * 60 * 60 * 1000

const LEDGER_DIR = path.join(homeDir, '.sparkle')
export const API2_PROBE_LEDGER_PATH = path.join(LEDGER_DIR, API2_PROBE_LEDGER_FILENAME)

let writeQueue: Promise<void> = Promise.resolve()
let appendCount = 0

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function ensureApi2ProbeLedgerDir(): Promise<void> {
  await mkdir(LEDGER_DIR, { recursive: true })
}

export async function readProviderDelayHistoryFromLedger(
  nodeName: string,
  lookbackMs: number = LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS,
): Promise<ProviderDelayHistoryFromLedgerEntry[]> {
  const sinceMs = Date.now() - lookbackMs
  const rows = await readApi2ProbeLedgerSince(sinceMs, 'active')
  return ledgerRowsToProviderDelayHistory(rows, nodeName)
}

export async function readLatencyTruthSummaryForNode(
  nodeName: string,
  lookbackMs: number = LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS,
): Promise<LatencyTruthSummary> {
  const sinceMs = Date.now() - lookbackMs
  const [vpsRows, activeRows] = await Promise.all([
    readApi2ProbeLedgerSince(sinceMs, 'vps'),
    readApi2ProbeLedgerSince(sinceMs, 'active'),
  ])
  return ledgerRowsToLatencyTruthSummary([...vpsRows, ...activeRows], nodeName)
}

export async function readRecentSessionNudgeAnchorsForNode(
  nodeName: string,
  lookbackMs: number = 20 * 60 * 1000,
): Promise<SessionNudgeDelayAnchor[]> {
  const sinceMs = Date.now() - lookbackMs
  try {
    const raw = await readFile(API2_PROBE_LEDGER_PATH, 'utf8')
    return readSessionNudgeAnchorsFromLedger(raw, sinceMs, nodeName)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function readApi2ProbeLedgerSince(
  sinceMs: number,
  scope?: Api2ProbeScope
): Promise<Api2ProbeLedgerRow[]> {
  try {
    const raw = await readFile(API2_PROBE_LEDGER_PATH, 'utf8')
    return readApi2ProbeLedgerRowsSince(raw, sinceMs, scope)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw error
  }
}

export async function appendApi2ProbeLedgerRow(row: Api2ProbeLedgerRow): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureApi2ProbeLedgerDir()
    await appendFile(API2_PROBE_LEDGER_PATH, `${JSON.stringify(row)}\n`, 'utf8')
    appendCount += 1
    if (appendCount % 200 === 0) {
      await pruneApi2ProbeLedger()
    }
  })
  await writeQueue
}

export async function pruneApi2ProbeLedger(
  retentionMs: number = API2_PROBE_LEDGER_RETENTION_MS
): Promise<void> {
  try {
    const raw = await readFile(API2_PROBE_LEDGER_PATH, 'utf8')
    if (!raw) return
    const cutoff = Date.now() - retentionMs
    const kept = raw
      .split('\n')
      .filter((line) => {
        if (!line.trim()) return false
        try {
          const parsed = JSON.parse(line) as Api2ProbeLedgerRow
          const ts = Date.parse(parsed.ts)
          return Number.isFinite(ts) && ts >= cutoff
        } catch {
          return false
        }
      })
    const nextContent = kept.length > 0 ? `${kept.join('\n')}\n` : ''
    await writeFile(API2_PROBE_LEDGER_PATH, nextContent, 'utf8')
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      appendAppLog(`[Api2ProbeLedger]: prune failed: ${formatError(error)}\n`)
    }
  }
}
