#!/usr/bin/env tsx
/** G9 soak monitor — attempt-level MaxStepsRate SLO (P28b primary). */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const LOG_DIR = path.join(homedir(), 'Library/Application Support/sparkle/logs')
const SNAPSHOT_PATH = path.join(homedir(), '.sparkle', 'max-steps-rate-snapshot.jsonl')
const TAIL_LINES = Number(process.env.G9_SOAK_TAIL_LINES ?? '400')

function latestAppLogPath(): string {
  const files = readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
    .map((name) => path.join(LOG_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (files.length === 0) {
    throw new Error(`no app logs under ${LOG_DIR}`)
  }
  return files[0]
}

function pickLastMatching(lines: string[], pattern: RegExp): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index])) {
      return lines[index].trim()
    }
  }
  return null
}

function readLatestSnapshotAttemptRate(): number | null {
  if (!readFileSync) {
    return null
  }
  try {
    const text = readFileSync(SNAPSHOT_PATH, 'utf8')
    const lines = text.split('\n').filter((line) => line.trim())
    if (lines.length === 0) {
      return null
    }
    const parsed = JSON.parse(lines[lines.length - 1]) as {
      attempt?: { primary?: { attemptRatePct?: number } }
    }
    return typeof parsed.attempt?.primary?.attemptRatePct === 'number'
      ? parsed.attempt.primary.attemptRatePct
      : null
  } catch {
    return null
  }
}

function main(): void {
  const logPath = latestAppLogPath()
  const tail = readFileSync(logPath, 'utf8').split('\n').slice(-TAIL_LINES)
  const maxSteps = pickLastMatching(tail, /\[MaxStepsRate\]:/)
  const recovery = pickLastMatching(tail, /\[RecoveryHonesty\]:/)

  const attemptEarlyDisconnect = maxSteps?.match(/attempts_early_disconnect=(\d+)/)?.[1] ?? 'unknown'
  const attemptStarted = maxSteps?.match(/attempts_started=(\d+)/)?.[1] ?? 'unknown'
  const attemptRateFromLog = maxSteps?.match(/attempt_rate_pct=([\d.]+)/)?.[1]
  const attemptRatePct =
    attemptRateFromLog != null ? Number(attemptRateFromLog) : readLatestSnapshotAttemptRate()
  const recoveryOutcome = recovery?.match(/outcome=(\w+)/)?.[1] ?? 'unknown'

  const pass =
    attemptEarlyDisconnect === '0' &&
    attemptRatePct !== null &&
    attemptRatePct >= 90 &&
    Number(attemptStarted) >= 10

  console.log(`[G9Soak] log=${logPath}`)
  console.log(`[G9Soak] max_steps_rate=${maxSteps ?? 'missing'}`)
  console.log(`[G9Soak] recovery_honesty=${recovery ?? 'missing'}`)
  console.log(
    `[G9Soak] summary attempts_started=${attemptStarted} attempts_early_disconnect=${attemptEarlyDisconnect} attempt_rate_pct=${attemptRatePct ?? 'missing'} recovery_outcome=${recoveryOutcome} pass=${pass ? '1' : '0'}`,
  )
  if (process.env.G9_SOAK_STRICT === '1' && !pass) {
    process.exit(1)
  }
}

main()
