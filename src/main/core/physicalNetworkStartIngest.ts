// [INPUT] ~/.cursor-500-guard/runtime-events/validated-ledger.v1.jsonl
// [OUTPUT] ingestPhysicalNetworkStartsFromLedger · countLedgerHttpSegmentStarted
// [POS] P10-5 incremental ingest — network_started rows for physical MaxStepsRate.

import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { dirname, join } from 'path'
import {
  countHttpSegmentStartedLedgerLines,
  parseNetworkStartedLedgerLine,
  type ParsedNetworkStartedLedgerRow,
} from './physicalNetworkStartFromLedgerCore'
import { discoverGuardValidatedLedgerPaths } from './guardValidatedLedgerPathsCore'

const INGEST_CHUNK_BYTES = 2_097_152

let testLedgerPathOverride: string | null = null
let testCachePathOverride: string | null = null
let testCheckpointPathOverride: string | null = null

export function setPhysicalNetworkStartIngestPathsForTests(input: {
  ledgerPath?: string
  cachePath?: string
  checkpointPath?: string
}): void {
  testLedgerPathOverride = input.ledgerPath ?? null
  testCachePathOverride = input.cachePath ?? null
  testCheckpointPathOverride = input.checkpointPath ?? null
}

export function resetPhysicalNetworkStartIngestPathsForTests(): void {
  testLedgerPathOverride = null
  testCachePathOverride = null
  testCheckpointPathOverride = null
}

function networkStartCachePath(): string {
  return testCachePathOverride ?? join(homedir(), '.sparkle', 'physical-network-starts.v1.jsonl')
}

function ingestCheckpointPath(): string {
  return (
    testCheckpointPathOverride ??
    join(homedir(), '.sparkle', 'physical-network-start-ingest-checkpoint.json')
  )
}

interface IngestCheckpoint {
  ledgerPath: string
  byteOffset: number
  fileSize: number
  updatedAtMs: number
}

interface MultiLedgerIngestCheckpoint {
  ledgers: Record<string, IngestCheckpoint>
  updatedAtMs: number
}

function readMultiLedgerCheckpoint(): MultiLedgerIngestCheckpoint {
  const checkpointFile = ingestCheckpointPath()
  if (!existsSync(checkpointFile)) {
    return { ledgers: {}, updatedAtMs: 0 }
  }
  try {
    const parsed = JSON.parse(readFileSync(checkpointFile, 'utf8')) as MultiLedgerIngestCheckpoint
    if (parsed.ledgers && typeof parsed.ledgers === 'object') {
      return parsed
    }
    const legacy = parsed as unknown as IngestCheckpoint
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

function writeMultiLedgerCheckpoint(checkpoint: MultiLedgerIngestCheckpoint): void {
  writeFileSync(ingestCheckpointPath(), `${JSON.stringify(checkpoint)}\n`, 'utf8')
}

function readCheckpoint(ledgerPath: string): IngestCheckpoint {
  const multi = readMultiLedgerCheckpoint()
  const existing = multi.ledgers[ledgerPath]
  if (existing) {
    return existing
  }
  return { ledgerPath, byteOffset: 0, fileSize: 0, updatedAtMs: 0 }
}

function writeCheckpoint(checkpoint: IngestCheckpoint): void {
  const multi = readMultiLedgerCheckpoint()
  multi.ledgers[checkpoint.ledgerPath] = checkpoint
  multi.updatedAtMs = checkpoint.updatedAtMs
  writeMultiLedgerCheckpoint(multi)
}

function readNetworkStartCache(): ParsedNetworkStartedLedgerRow[] {
  const cacheFile = networkStartCachePath()
  if (!existsSync(cacheFile)) {
    return []
  }
  try {
    const text = readFileSync(cacheFile, 'utf8')
    const rows: ParsedNetworkStartedLedgerRow[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) {
        continue
      }
      try {
        rows.push(JSON.parse(line) as ParsedNetworkStartedLedgerRow)
      } catch {
        continue
      }
    }
    return rows
  } catch {
    return []
  }
}

async function ingestLedgerNetworkStartsFromOffset(
  ledgerPath: string,
  startOffset: number,
): Promise<{ rows: ParsedNetworkStartedLedgerRow[]; endOffset: number }> {
  const rows: ParsedNetworkStartedLedgerRow[] = []
  const stream = createReadStream(ledgerPath, {
    start: startOffset,
    highWaterMark: INGEST_CHUNK_BYTES,
  })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    const parsed = parseNetworkStartedLedgerLine(line)
    if (parsed) {
      rows.push(parsed)
    }
  }
  const endOffset = statSync(ledgerPath).size
  return { rows, endOffset }
}

function appendNetworkStartRows(rows: readonly ParsedNetworkStartedLedgerRow[]): void {
  if (rows.length === 0) {
    return
  }
  const cacheFile = networkStartCachePath()
  mkdirSync(dirname(cacheFile), { recursive: true })
  const lines = rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  appendFileSync(cacheFile, lines, 'utf8')
}

export async function ingestPhysicalNetworkStartsFromLedger(
  nowMs: number = Date.now(),
): Promise<ParsedNetworkStartedLedgerRow[]> {
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
    const { rows, endOffset } = await ingestLedgerNetworkStartsFromOffset(ledgerPath, startOffset)
    appendNetworkStartRows(rows)
    writeCheckpoint({
      ledgerPath,
      byteOffset: endOffset,
      fileSize,
      updatedAtMs: nowMs,
    })
  }
  return readNetworkStartCache()
}

export function countLedgerHttpSegmentStarted(ledgerPath?: string): number {
  if (ledgerPath) {
    if (!existsSync(ledgerPath)) {
      return 0
    }
    const text = readFileSync(ledgerPath, 'utf8')
    return countHttpSegmentStartedLedgerLines(text.split('\n'))
  }
  let total = 0
  for (const path of discoverGuardValidatedLedgerPaths()) {
    if (!existsSync(path)) {
      continue
    }
    const text = readFileSync(path, 'utf8')
    total += countHttpSegmentStartedLedgerLines(text.split('\n'))
  }
  return total
}
