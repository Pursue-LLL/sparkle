// [INPUT] StreamContinuationIntentEvent
// [OUTPUT] appendStreamContinuationJournalEvents · readStreamContinuationJournalTail
// [POS] P10-4 durable continuation journal — append-only intent/ACK facts.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { StreamContinuationIntentEvent } from './p10ContinuationJournalCore'

// [POS] P10-4 Sparkle-side lifecycle mirror — Guard SSOT is ~/.cursor-500-guard/continuation-intent-journal.v1.jsonl

const JOURNAL_FILE = join(homedir(), '.sparkle', 'stream-continuation-journal.v1.jsonl')

let testJournalPathOverride: string | null = null

export function setStreamContinuationJournalPathForTests(path: string | null): void {
  testJournalPathOverride = path
}

function journalPath(): string {
  return testJournalPathOverride ?? JOURNAL_FILE
}

export function appendStreamContinuationJournalEvents(
  events: readonly StreamContinuationIntentEvent[],
): void {
  if (events.length === 0) {
    return
  }
  const filePath = journalPath()
  mkdirSync(dirname(filePath), { recursive: true })
  const lines = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  appendFileSync(filePath, lines, 'utf8')
}

export function readStreamContinuationJournalTail(
  limit: number = 4096,
): StreamContinuationIntentEvent[] {
  const filePath = journalPath()
  if (!existsSync(filePath)) {
    return []
  }
  const text = readFileSync(filePath, 'utf8')
  const lines = text.split('\n').filter((line) => line.trim())
  const rows: StreamContinuationIntentEvent[] = []
  for (const line of lines.slice(-limit)) {
    try {
      rows.push(JSON.parse(line) as StreamContinuationIntentEvent)
    } catch {
      continue
    }
  }
  return rows
}
