// [INPUT] ~/.cursor-500-guard/runtime-events/validated-ledger.v1.jsonl
// [OUTPUT] ingestValidatedLedgerTerminals · readValidatedLedgerTerminalCache
// [POS] G8 incremental ingest — stream_terminated only, checkpointed append to ~/.sparkle cache.

import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  parseValidatedLedgerTerminalLine,
  type ValidatedLedgerTerminalRow,
} from './validatedLedgerTerminalCore'
import { discoverGuardValidatedLedgerPaths } from './guardValidatedLedgerPathsCore'

const INGEST_CHUNK_BYTES = 2_097_152
const CACHE_MAX_LINES = 20_000

export interface ValidatedLedgerIngestCheckpoint {
  ledgerPath: string
  byteOffset: number
  fileSize: number
  updatedAtMs: number
}

let testLedgerPathOverride: string | null = null
let testCachePathOverride: string | null = null
let testCheckpointPathOverride: string | null = null

export function setValidatedLedgerIngestPathsForTests(input: {
  ledgerPath?: string
  cachePath?: string
  checkpointPath?: string
}): void {
  testLedgerPathOverride = input.ledgerPath ?? null
  testCachePathOverride = input.cachePath ?? null
  testCheckpointPathOverride = input.checkpointPath ?? null
}

export function resetValidatedLedgerIngestPathsForTests(): void {
  testLedgerPathOverride = null
  testCachePathOverride = null
  testCheckpointPathOverride = null
}

interface MultiLedgerTerminalCheckpoint {
  ledgers: Record<string, ValidatedLedgerIngestCheckpoint>
  updatedAtMs: number
}

function readMultiLedgerCheckpoint(): MultiLedgerTerminalCheckpoint {
  const checkpointFile = ingestCheckpointPath()
  if (!existsSync(checkpointFile)) {
    return { ledgers: {}, updatedAtMs: 0 }
  }
  try {
    const parsed = JSON.parse(readFileSync(checkpointFile, 'utf8')) as MultiLedgerTerminalCheckpoint
    if (parsed.ledgers && typeof parsed.ledgers === 'object') {
      return parsed
    }
    const legacy = parsed as unknown as ValidatedLedgerIngestCheckpoint
    if (legacy.ledgerPath) {
      return {
        ledgers: { [legacy.ledgerPath]: legacy },
        updatedAtMs: legacy.updatedAtMs ?? 0,
      }
    }
    return { ledgers: {}, updatedAtMs: 0 }
  } catch {
    return { ledgers: {}, updatedAtMs: 0 }
  }
}

function writeMultiLedgerCheckpoint(checkpoint: MultiLedgerTerminalCheckpoint): void {
  writeFileSync(ingestCheckpointPath(), `${JSON.stringify(checkpoint)}\n`, 'utf8')
}

function readCheckpoint(ledgerPath: string): ValidatedLedgerIngestCheckpoint {
  const multi = readMultiLedgerCheckpoint()
  const existing = multi.ledgers[ledgerPath]
  if (existing) {
    return existing
  }
  return { ledgerPath, byteOffset: 0, fileSize: 0, updatedAtMs: 0 }
}

function writeCheckpoint(checkpoint: ValidatedLedgerIngestCheckpoint): void {
  const multi = readMultiLedgerCheckpoint()
  multi.ledgers[checkpoint.ledgerPath] = checkpoint
  multi.updatedAtMs = checkpoint.updatedAtMs
  writeMultiLedgerCheckpoint(multi)
}

function terminalCachePath(): string {
  return testCachePathOverride ?? join(homedir(), '.sparkle', 'validated-ledger-terminals.v1.jsonl')
}

function ingestCheckpointPath(): string {
  return testCheckpointPathOverride ?? join(homedir(), '.sparkle', 'validated-ledger-ingest-checkpoint.json')
}

function appendTerminalRows(rows: readonly ValidatedLedgerTerminalRow[]): void {
  if (rows.length === 0) {
    return
  }
  const cacheFile = terminalCachePath()
  mkdirSync(dirname(cacheFile), { recursive: true })
  const lines = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  appendFileSync(cacheFile, lines, 'utf8')
  trimTerminalCache(cacheFile)
}

function trimTerminalCache(cacheFile: string): void {
  if (!existsSync(cacheFile)) {
    return
  }
  try {
    const stat = statSync(cacheFile)
    if (stat.size < CACHE_MAX_LINES * 256) {
      return
    }
    const tailStart = Math.max(0, stat.size - CACHE_MAX_LINES * 256)
    const fd = openSync(cacheFile, 'r')
    try {
      const buf = Buffer.alloc(stat.size - tailStart)
      readSync(fd, buf, 0, buf.length, tailStart)
      const text = buf.toString('utf8')
      const lines = text.split('\n').filter((line) => line.trim())
      const kept = lines.slice(-CACHE_MAX_LINES)
      writeFileSync(cacheFile, `${kept.join('\n')}\n`, 'utf8')
    } finally {
      closeSync(fd)
    }
  } catch {
    // cache trim is best-effort
  }
}

async function ingestLedgerFromOffset(
  ledgerPath: string,
  startOffset: number,
): Promise<{ rows: ValidatedLedgerTerminalRow[]; endOffset: number }> {
  const rows: ValidatedLedgerTerminalRow[] = []
  const stream = createReadStream(ledgerPath, {
    start: startOffset,
    highWaterMark: INGEST_CHUNK_BYTES,
  })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    const parsed = parseValidatedLedgerTerminalLine(line)
    if (parsed) {
      rows.push(parsed)
    }
  }
  const endOffset = statSync(ledgerPath).size
  return { rows, endOffset }
}

export async function ingestValidatedLedgerTerminals(
  nowMs: number = Date.now(),
): Promise<ValidatedLedgerTerminalRow[]> {
  const ledgerPaths = testLedgerPathOverride
    ? [testLedgerPathOverride]
    : discoverGuardValidatedLedgerPaths()
  for (const ledgerPath of ledgerPaths) {
    if (!existsSync(ledgerPath)) {
      continue
    }
    const fileSize = statSync(ledgerPath).size
    const checkpoint = readCheckpoint(ledgerPath)
    let startOffset = checkpoint.byteOffset
    if (fileSize < checkpoint.fileSize || startOffset > fileSize) {
      startOffset = 0
    }
    if (startOffset >= fileSize) {
      continue
    }
    const { rows, endOffset } = await ingestLedgerFromOffset(ledgerPath, startOffset)
    appendTerminalRows(rows)
    writeCheckpoint({
      ledgerPath,
      byteOffset: endOffset,
      fileSize,
      updatedAtMs: nowMs,
    })
  }
  return readValidatedLedgerTerminalCache()
}

export function readValidatedLedgerTerminalCache(): ValidatedLedgerTerminalRow[] {
  const cacheFile = terminalCachePath()
  if (!existsSync(cacheFile)) {
    return []
  }
  try {
    const text = readFileSync(cacheFile, 'utf8')
    const rows: ValidatedLedgerTerminalRow[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        continue
      }
      try {
        rows.push(JSON.parse(line) as ValidatedLedgerTerminalRow)
      } catch {
        continue
      }
    }
    return rows
  } catch {
    return []
  }
}
