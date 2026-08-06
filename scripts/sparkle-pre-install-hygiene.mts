#!/usr/bin/env tsx
/** Pre-install hygiene — truncate oversized lifecycle journal + block upgrade on disk pressure. */
import { closeSync, existsSync, fstatSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  evaluatePreInstallHygiene,
  formatPreInstallHygieneLog,
  PRE_INSTALL_JOURNAL_TRUNCATE_BYTES,
  type PreInstallHygieneInput,
} from './sparklePreInstallHygieneCore.ts'

const JOURNAL_PATH = path.join(homedir(), '.sparkle', 'stream-lifecycle-journal.v1.jsonl')

function readJournalTailText(filePath: string): string {
  if (!existsSync(filePath)) {
    return ''
  }
  const fd = openSync(filePath, 'r')
  try {
    const fileSize = fstatSync(fd).size
    if (fileSize <= PRE_INSTALL_JOURNAL_TRUNCATE_BYTES) {
      return readFileUtf8(filePath)
    }
    const start = fileSize - PRE_INSTALL_JOURNAL_TRUNCATE_BYTES
    const buffer = Buffer.alloc(fileSize - start)
    readSync(fd, buffer, 0, buffer.length, start)
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

function readFileUtf8(filePath: string): string {
  const fd = openSync(filePath, 'r')
  try {
    const fileSize = fstatSync(fd).size
    const buffer = Buffer.alloc(fileSize)
    readSync(fd, buffer, 0, fileSize, 0)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function readDataVolumeUsedPct(): number {
  try {
    const output = execFileSync('df', ['-k', '/'], { encoding: 'utf8' })
    const line = output.trim().split('\n').slice(-1)[0] ?? ''
    const parts = line.trim().split(/\s+/)
    const usedPctToken = parts.find((part) => part.endsWith('%')) ?? '0%'
    return Number.parseInt(usedPctToken.replace('%', ''), 10)
  } catch {
    return 0
  }
}

function truncateJournalIfNeeded(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false
  }
  const tail = readJournalTailText(filePath)
  const normalized = tail.length > 0 ? (tail.endsWith('\n') ? tail : `${tail}\n`) : ''
  writeFileSync(filePath, normalized, 'utf8')
  return true
}

function main(): void {
  const journalBytes = existsSync(JOURNAL_PATH) ? statSync(JOURNAL_PATH).size : 0
  const input: PreInstallHygieneInput = {
    journalBytes,
    dataVolumeUsedPct: readDataVolumeUsedPct(),
  }
  const plan = evaluatePreInstallHygiene(input)
  console.log(formatPreInstallHygieneLog(input, plan))

  if (plan.truncateJournal) {
    truncateJournalIfNeeded(JOURNAL_PATH)
    const afterBytes = existsSync(JOURNAL_PATH) ? statSync(JOURNAL_PATH).size : 0
    console.log(`[PreInstallHygiene]: journal_truncated after_bytes=${afterBytes}`)
  }

  if (plan.blockUpgrade) {
    process.exit(1)
  }
}

main()
