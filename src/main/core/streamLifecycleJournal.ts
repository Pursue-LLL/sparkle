// [INPUT] StreamLifecycleEvent
// [OUTPUT] appendStreamLifecycleJournalEvents · readStreamLifecycleJournalTail
// [POS] P10-1 durable lifecycle journal — append-only reducer input SSOT.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { StreamLifecycleEvent } from './streamLifecycleTruthCore'

const JOURNAL_FILE = join(homedir(), '.sparkle', 'stream-lifecycle-journal.v1.jsonl')

let testJournalPathOverride: string | null = null

export function setStreamLifecycleJournalPathForTests(path: string | null): void {
  testJournalPathOverride = path
}

function journalPath(): string {
  return testJournalPathOverride ?? JOURNAL_FILE
}

export function appendStreamLifecycleJournalEvents(events: readonly StreamLifecycleEvent[]): void {
  if (events.length === 0) {
    return
  }
  const filePath = journalPath()
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  appendFileSync(filePath, lines, 'utf8')
}

export function readStreamLifecycleJournalTail(limit: number = 4096): StreamLifecycleEvent[] {
  const filePath = journalPath()
  if (!existsSync(filePath)) {
    return []
  }
  const text = readFileSync(filePath, 'utf8')
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
