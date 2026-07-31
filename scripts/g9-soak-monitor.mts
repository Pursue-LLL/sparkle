#!/usr/bin/env tsx
/** G9 soak monitor — attempt-level MaxStepsRate SLO (P28b primary). */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  evaluateG9SoakPass,
  parseG9SoakMetrics,
} from './g9SoakMonitorCore.ts'
import { evaluateMaxStepsRateUpgradeGate } from './maxStepsRateUpgradeGateCore.ts'

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
  const snapshotAttemptRate = readLatestSnapshotAttemptRate()
  const metrics = parseG9SoakMetrics(maxSteps, recovery, snapshotAttemptRate)
  const pass = evaluateG9SoakPass(metrics)
  const upgradeGate = evaluateMaxStepsRateUpgradeGate({
    maxStepsLogLine: maxSteps,
    snapshotAttemptRatePct: snapshotAttemptRate,
  })

  console.log(`[G9Soak] log=${logPath}`)
  console.log(`[G9Soak] max_steps_rate=${maxSteps ?? 'missing'}`)
  console.log(`[G9Soak] recovery_honesty=${recovery ?? 'missing'}`)
  console.log(`[G9Soak] upgrade_gate=${upgradeGate.reason} allow=${upgradeGate.allowUpgrade ? 1 : 0}`)
  console.log(
    `[G9Soak] summary attempts_started=${metrics.attemptsStarted ?? 'unknown'} attempts_early_disconnect=${metrics.attemptsEarlyDisconnect ?? 'unknown'} attempt_rate_pct=${metrics.attemptRatePct ?? 'missing'} below_target_attempt=${metrics.belowTargetAttempt == null ? 'unknown' : metrics.belowTargetAttempt ? 1 : 0} recovery_outcome=${metrics.recoveryOutcome ?? 'unknown'} pass=${pass ? '1' : '0'}`,
  )
  if (process.env.G9_SOAK_STRICT === '1' && (!pass || !upgradeGate.allowUpgrade)) {
    process.exit(1)
  }
}

main()
