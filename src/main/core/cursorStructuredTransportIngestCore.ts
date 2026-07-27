// [INPUT] agentTransportFailureSync log listing · agentTransportFailureWriterCore parser
// [OUTPUT] readRecentStructuredTransportFailures · merge into connect partition hot path
// [POS] P17 hung_scan hot path — Structured tail without waiting for jsonl round-trip · P18 tail cache.

import { stat } from 'fs/promises'
import {
  listCursorStructuredLogFiles,
  readLogFileTail,
  resolveCursorDataDirs,
} from './agentTransportFailureSync'
import {
  parseTransportFailureLine,
  shouldPersistTransportFailure,
  type AgentTransportFailureRow,
} from './agentTransportFailureWriterCore'
import { readStructuredLogTailCached } from './cursorStructuredTailCacheCore'

const STRUCTURED_HOT_TAIL_BYTES = 512_000
const HOT_LOOKBACK_MS = 120_000

export interface StructuredTransportIngestResult {
  rows: AgentTransportFailureRow[]
  structuredFiles: number
  logRoots: number
}

async function readStructuredTransportFromRoots(
  sinceMs: number,
  cursorDataDirs: string[],
): Promise<StructuredTransportIngestResult> {
  const rows: AgentTransportFailureRow[] = []
  let structuredFiles = 0
  for (const cursorDataDir of cursorDataDirs) {
    for (const filePath of await listCursorStructuredLogFiles(cursorDataDir)) {
      structuredFiles += 1
      const text = await readStructuredLogTailCached(
        filePath,
        STRUCTURED_HOT_TAIL_BYTES,
        readLogFileTail,
        async (path) => {
          const fileStat = await stat(path)
          return { mtimeMs: fileStat.mtimeMs, size: fileStat.size }
        },
      )
      for (const line of text.split('\n')) {
        const candidate = parseTransportFailureLine(line)
        if (
          !candidate ||
          candidate.ts < sinceMs ||
          !shouldPersistTransportFailure(candidate)
        ) {
          continue
        }
        rows.push(candidate)
      }
    }
  }
  return { rows, structuredFiles, logRoots: cursorDataDirs.length }
}

export async function readRecentStructuredTransportFailures(
  sinceMs: number,
  cursorDataDirs?: string[],
): Promise<AgentTransportFailureRow[]> {
  const roots = cursorDataDirs ?? (await resolveCursorDataDirs())
  const result = await readStructuredTransportFromRoots(sinceMs, roots)
  return result.rows
}

export async function readRecentStructuredTransportFailuresForPartition(
  nowMs: number = Date.now(),
  cursorDataDirs?: string[],
): Promise<StructuredTransportIngestResult> {
  return readStructuredTransportFromRoots(nowMs - HOT_LOOKBACK_MS, cursorDataDirs ?? (await resolveCursorDataDirs()))
}
