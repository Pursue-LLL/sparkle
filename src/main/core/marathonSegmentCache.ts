// [INPUT] HttpSegmentStartedSample from cursorSegmentHandoffCore
// [OUTPUT] readMarathonSegmentCache · appendMarathonSegmentCache · mergeMarathonSegmentRecords
// [POS] P22b append-only ~/.sparkle/marathon-segments.v1.jsonl — immune to renderer log rotation.

import { appendFile, mkdir, open, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { HttpSegmentStartedSample } from './cursorSegmentHandoffCore'

export const MARATHON_SEGMENT_CACHE_FILENAME = 'marathon-segments.v1.jsonl'
export const MARATHON_SEGMENT_CACHE_MAX_AGE_MS = 86_400_000
/** Read at most this many trailing bytes — avoids full-file scan on long marathon days. */
export const MARATHON_SEGMENT_CACHE_READ_TAIL_BYTES = 512_000

export interface MarathonSegmentCacheRecord {
  segmentId: string
  requestId: string
  originalRequestId: string
  composerId: string
  actionCase: string
  httpStartMs: number
  recordedAtMs: number
}

export function marathonSegmentCachePath(): string {
  return join(homedir(), '.sparkle', MARATHON_SEGMENT_CACHE_FILENAME)
}

export function segmentSampleToCacheRecord(
  sample: HttpSegmentStartedSample,
  recordedAtMs: number,
): MarathonSegmentCacheRecord {
  return {
    segmentId: sample.segmentId,
    requestId: sample.requestId,
    originalRequestId: sample.originalRequestId,
    composerId: sample.composerId,
    actionCase: sample.actionCase,
    httpStartMs: sample.httpStartMs,
    recordedAtMs,
  }
}

export function parseMarathonSegmentCacheLine(line: string): MarathonSegmentCacheRecord | undefined {
  const trimmed = line.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    const row = JSON.parse(trimmed) as Partial<MarathonSegmentCacheRecord>
    const segmentId = String(row.segmentId ?? '').trim()
    const requestId = String(row.requestId ?? '').trim()
    const originalRequestId = String(row.originalRequestId ?? row.requestId ?? '').trim()
    const httpStartMs = typeof row.httpStartMs === 'number' ? row.httpStartMs : 0
    if (!segmentId || !requestId || httpStartMs <= 0) {
      return undefined
    }
    return {
      segmentId,
      requestId,
      originalRequestId: originalRequestId || requestId,
      composerId: String(row.composerId ?? '').trim(),
      actionCase: String(row.actionCase ?? '').trim(),
      httpStartMs,
      recordedAtMs: typeof row.recordedAtMs === 'number' ? row.recordedAtMs : httpStartMs,
    }
  } catch {
    return undefined
  }
}

export async function readMarathonSegmentCacheText(path: string): Promise<string> {
  if (!existsSync(path)) {
    return ''
  }
  const fileStat = await stat(path)
  if (fileStat.size <= MARATHON_SEGMENT_CACHE_READ_TAIL_BYTES) {
    return readFile(path, 'utf8')
  }
  const start = fileStat.size - MARATHON_SEGMENT_CACHE_READ_TAIL_BYTES
  const length = fileStat.size - start
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    let text = buffer.toString('utf8')
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) {
      text = text.slice(firstNewline + 1)
    }
    return text
  } finally {
    await handle.close()
  }
}

export async function readMarathonSegmentCache(nowMs: number): Promise<MarathonSegmentCacheRecord[]> {
  const path = marathonSegmentCachePath()
  const text = await readMarathonSegmentCacheText(path)
  if (!text) {
    return []
  }
  const sinceMs = nowMs - MARATHON_SEGMENT_CACHE_MAX_AGE_MS
  const bySegmentId = new Map<string, MarathonSegmentCacheRecord>()
  for (const line of text.split('\n')) {
    const record = parseMarathonSegmentCacheLine(line)
    if (!record || record.httpStartMs < sinceMs) {
      continue
    }
    const prev = bySegmentId.get(record.segmentId)
    if (!prev || record.httpStartMs >= prev.httpStartMs) {
      bySegmentId.set(record.segmentId, record)
    }
  }
  return [...bySegmentId.values()]
}

export async function appendMarathonSegmentCache(
  samples: readonly HttpSegmentStartedSample[],
  knownSegmentIds: ReadonlySet<string>,
  nowMs: number,
): Promise<number> {
  const fresh = samples.filter((sample) => !knownSegmentIds.has(sample.segmentId))
  if (fresh.length === 0) {
    return 0
  }
  const dir = join(homedir(), '.sparkle')
  await mkdir(dir, { recursive: true })
  const lines = fresh
    .map((sample) => JSON.stringify(segmentSampleToCacheRecord(sample, nowMs)))
    .join('\n')
  await appendFile(marathonSegmentCachePath(), `${lines}\n`, 'utf8')
  return fresh.length
}

export function mergeMarathonSegmentRecords(
  cacheRecords: readonly MarathonSegmentCacheRecord[],
  tailSamples: readonly HttpSegmentStartedSample[],
): HttpSegmentStartedSample[] {
  const bySegmentId = new Map<string, HttpSegmentStartedSample>()
  for (const record of cacheRecords) {
    bySegmentId.set(record.segmentId, {
      segmentId: record.segmentId,
      requestId: record.requestId,
      originalRequestId: record.originalRequestId,
      composerId: record.composerId,
      actionCase: record.actionCase,
      httpStartMs: record.httpStartMs,
    })
  }
  for (const sample of tailSamples) {
    const prev = bySegmentId.get(sample.segmentId)
    if (!prev || sample.httpStartMs >= prev.httpStartMs) {
      bySegmentId.set(sample.segmentId, sample)
    }
  }
  return [...bySegmentId.values()]
}
