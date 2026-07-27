// [INPUT] connectPartitionDetectCore · transportObservabilityMergeCore · cursorStructuredTransportIngestCore
// [OUTPUT] readConnectPartitionSignalAsync · readAgentTransportJsonlTailRows
// [POS] P18 — deduped structured+jsonl merge SSOT for connect partition + blind-spot metrics.

import { existsSync, openSync, readSync, closeSync, statSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  detectConnectPartitionSignal,
  resolveConnectPartitionWindowMs,
  type AgentTransportFailureRow,
  type ConnectPartitionSignal,
} from './connectPartitionDetectCore'
import {
  countConnectPingFailuresInWindow,
  mergeTransportFailureRows,
} from './transportObservabilityMergeCore'

const JSONL_TAIL_BYTES = 512_000

function sparkleHomeDir(): string {
  return homedir()
}

function guardLegacyRootDir(): string {
  return join(sparkleHomeDir(), '.cursor-500-guard')
}

function sparkleAgentTransportPath(): string {
  return join(sparkleHomeDir(), '.sparkle', 'agent-transport-failures.jsonl')
}

function guardAgentTransportPath(): string {
  return join(guardLegacyRootDir(), 'agent-transport-failures.jsonl')
}

function guardProfilesDir(): string {
  return join(guardLegacyRootDir(), 'profiles')
}

export interface ConnectPartitionReadResult {
  signal: ConnectPartitionSignal | undefined
  structuredRows: AgentTransportFailureRow[]
  jsonlRows: AgentTransportFailureRow[]
  mergedRows: AgentTransportFailureRow[]
  structuredFiles: number
  logRoots: number
  structuredPingCount: number
  jsonlPingCount: number
}

/** Mirror Guard `agentTransportFailurePaths()` read side: sparkle + legacy root + per-profile dirs. */
export function agentTransportJsonlPaths(): string[] {
  const paths = new Set<string>([sparkleAgentTransportPath(), guardAgentTransportPath()])
  const profilesDir = guardProfilesDir()
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      paths.add(join(profilesDir, entry.name, 'agent-transport-failures.jsonl'))
    }
  }
  return [...paths]
}

export function readAgentTransportJsonlTailRows(): AgentTransportFailureRow[] {
  const rows: AgentTransportFailureRow[] = []
  for (const filePath of agentTransportJsonlPaths()) {
    rows.push(...readJsonlTail(filePath))
  }
  return rows
}

function readJsonlTail(filePath: string): AgentTransportFailureRow[] {
  if (!existsSync(filePath)) {
    return []
  }
  try {
    const fileStat = statSync(filePath)
    const start = Math.max(0, fileStat.size - JSONL_TAIL_BYTES)
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(fileStat.size - start)
      readSync(fd, buf, 0, buf.length, start)
      const rows: AgentTransportFailureRow[] = []
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) {
          continue
        }
        try {
          rows.push(JSON.parse(line) as AgentTransportFailureRow)
        } catch {
          continue
        }
      }
      return rows
    } finally {
      closeSync(fd)
    }
  } catch {
    return []
  }
}

function detectFromMergedRows(
  mergedRows: readonly AgentTransportFailureRow[],
  cursorConnectionCount: number,
  nowMs: number,
): ConnectPartitionSignal | undefined {
  return detectConnectPartitionSignal(mergedRows, {
    nowMs,
    cursorConnectionCount,
    windowMs: resolveConnectPartitionWindowMs(cursorConnectionCount),
  })
}

/** @deprecated Prefer readConnectPartitionSignalAsync — sync jsonl-only path retained for tests. */
export function readConnectPartitionSignal(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
  extraRows: readonly AgentTransportFailureRow[] = [],
): ConnectPartitionSignal | undefined {
  const jsonlRows = readAgentTransportJsonlTailRows()
  const mergedRows = mergeTransportFailureRows(extraRows, jsonlRows)
  return detectFromMergedRows(mergedRows, cursorConnectionCount, nowMs)
}

/** P18: deduped structured hot tail + jsonl tail → ConnectPartitionSignal + observability metrics. */
export async function readConnectPartitionSignalAsync(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
  cursorDataDirs?: string[],
): Promise<ConnectPartitionReadResult> {
  const { readRecentStructuredTransportFailuresForPartition } = await import(
    './cursorStructuredTransportIngestCore'
  )
  const structuredIngest = await readRecentStructuredTransportFailuresForPartition(
    nowMs,
    cursorDataDirs,
  )
  const jsonlRows = readAgentTransportJsonlTailRows()
  const mergedRows = mergeTransportFailureRows(structuredIngest.rows, jsonlRows)
  const signal = detectFromMergedRows(mergedRows, cursorConnectionCount, nowMs)
  const structuredPingCount = countConnectPingFailuresInWindow(
    structuredIngest.rows,
    nowMs,
    cursorConnectionCount,
  )
  const jsonlPingCount = countConnectPingFailuresInWindow(jsonlRows, nowMs, cursorConnectionCount)
  return {
    signal,
    structuredRows: structuredIngest.rows,
    jsonlRows,
    mergedRows,
    structuredFiles: structuredIngest.structuredFiles,
    logRoots: structuredIngest.logRoots,
    structuredPingCount,
    jsonlPingCount,
  }
}
