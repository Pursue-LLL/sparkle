// [INPUT] StreamLifecycleEvent
// [OUTPUT] appendStreamLifecycleJournalEvents · readStreamLifecycleJournalTail
// [POS] P10-1 durable lifecycle journal — append-only reducer input SSOT.

import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { StreamLifecycleEvent } from './streamLifecycleTruthCore'

const JOURNAL_FILE = join(homedir(), '.sparkle', 'stream-lifecycle-journal.v1.jsonl')
/** Read at most this many trailing bytes — avoids V8 max-string blow-up on long marathon days. */
export const STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES = 8_388_608
/** Compact on append when journal exceeds this size — prevents ENOSPC from unbounded growth. */
export const STREAM_LIFECYCLE_JOURNAL_MAX_BYTES = STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES * 2

let testJournalPathOverride: string | null = null

export function setStreamLifecycleJournalPathForTests(path: string | null): void {
  testJournalPathOverride = path
}

function journalPath(): string {
  return testJournalPathOverride ?? JOURNAL_FILE
}

export function compactStreamLifecycleJournalIfOversized(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }
  if (statSync(filePath).size <= STREAM_LIFECYCLE_JOURNAL_MAX_BYTES) {
    return false
  }
  const tail = readStreamLifecycleJournalTailText(filePath)
  const normalized =
    tail.length > 0 ? (tail.endsWith('\n') ? tail : `${tail}\n`) : ''
  writeFileSync(filePath, normalized, 'utf8')
  return true
}

export function appendStreamLifecycleJournalEvents(events: readonly StreamLifecycleEvent[]): void {
  if (events.length === 0) {
    return
  }
  const filePath = journalPath()
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  appendFileSync(filePath, lines, 'utf8')
  compactStreamLifecycleJournalIfOversized(filePath)
}

export function readStreamLifecycleJournalTailText(filePath: string): string {
  if (!existsSync(filePath)) {
    return ''
  }
  const fd = openSync(filePath, 'r')
  try {
    const fileSize = fstatSync(fd).size
    if (fileSize <= STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES) {
      return readFileSync(filePath, 'utf8')
    }
    const start = fileSize - STREAM_LIFECYCLE_JOURNAL_READ_TAIL_BYTES
    const length = fileSize - start
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, start)
    let text = buffer.toString('utf8')
    const firstNewline = text.indexOf('\n')
    if (firstNewline >= 0) {
      text = text.slice(firstNewline + 1)
    }
    return text
  } finally {
    closeSync(fd)
  }
}

export function readStreamLifecycleJournalTail(limit: number = 4096): StreamLifecycleEvent[] {
  const filePath = journalPath()
  const text = readStreamLifecycleJournalTailText(filePath)
  if (!text) {
    return []
  }
  const lines = text.split('\n').filter((line) => line.trim())
  const rows: StreamLifecycleEvent[] = []
  for (const line of lines.slice(-limit)) {
    try {
      rows.push(JSON.parse(line) as StreamLifecycleEvent)
    } catch {
      continue
    }
  }
  return rows
}

export function mergeStreamLifecycleJournalEvents(
  persisted: readonly StreamLifecycleEvent[],
  projected: readonly StreamLifecycleEvent[],
): StreamLifecycleEvent[] {
  const seen = new Set(persisted.map((event) => event.eventId))
  const merged = [...persisted]
  for (const event of projected) {
    if (seen.has(event.eventId)) {
      continue
    }
    merged.push(event)
    seen.add(event.eventId)
  }
  return merged.sort((a, b) => a.sequence - b.sequence || a.occurredAtMs - b.occurredAtMs)
}
