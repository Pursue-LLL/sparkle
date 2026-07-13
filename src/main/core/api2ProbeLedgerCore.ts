import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { homeDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import {
  readApi2ProbeLedgerRowsSince,
  type Api2ProbeLedgerRow,
  type Api2ProbeScope
} from './api2ProbeLedgerRowCore'

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
