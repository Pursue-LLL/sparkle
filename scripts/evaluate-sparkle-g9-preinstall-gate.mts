#!/usr/bin/env -S node --import tsx
/** G9 pre-install gate — block upgrade:mac when rolling attempt SLO is below target. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evaluateMaxStepsRateUpgradeGate } from './maxStepsRateUpgradeGateCore.ts'

function pickLastMatching(text: string, prefix: string): string | null {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line.includes(prefix)) {
      return line
    }
  }
  return null
}

function readSnapshotAttemptRatePct(): number | null {
  const snapshotPath = join(homedir(), '.sparkle', 'max-steps-rate-snapshot.jsonl')
  if (!existsSync(snapshotPath)) {
    return null
  }
  const tail = readFileSync(snapshotPath, 'utf8').trim().split('\n').at(-1)
  if (!tail) {
    return null
  }
  try {
    const parsed = JSON.parse(tail) as {
      attempt?: { primary?: { attemptRatePct?: number } }
    }
    return typeof parsed.attempt?.primary?.attemptRatePct === 'number'
      ? parsed.attempt.primary.attemptRatePct
      : null
  } catch {
    return null
  }
}

function readLatestAppLogTail(): string {
  const logDir = join(homedir(), 'Library/Application Support/sparkle/logs')
  if (!existsSync(logDir)) {
    return ''
  }
  try {
    const candidates = readdirSync(logDir)
      .filter((name) => name.startsWith('app-') && name.endsWith('.log'))
      .map((name) => join(logDir, name))
      .filter((path) => existsSync(path))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    if (!candidates[0]) {
      return ''
    }
    const text = readFileSync(candidates[0], 'utf8')
    return text.slice(Math.max(0, text.length - 512_000))
  } catch {
    return ''
  }
}

function main(): void {
  if (process.env.SPARKLE_UPGRADE_SKIP_G9_GATE === '1') {
    console.error('[G9PreInstallGate] skip=1 reason=SPARKLE_UPGRADE_SKIP_G9_GATE')
    return
  }

  const appLogTail = readLatestAppLogTail()
  const maxStepsLogLine = pickLastMatching(appLogTail, '[MaxStepsRate]:')
  const snapshotAttemptRatePct = readSnapshotAttemptRatePct()
  const gate = evaluateMaxStepsRateUpgradeGate({
    maxStepsLogLine,
    snapshotAttemptRatePct,
    advisoryOnly: process.env.SPARKLE_UPGRADE_G9_ADVISORY === '1',
  })

  console.error(
    `[G9PreInstallGate] allow=${gate.allowUpgrade ? 1 : 0} reason=${gate.reason}` +
      ` attempts_started=${gate.attemptsStarted ?? 'unknown'}` +
      ` attempt_rate_pct=${gate.attemptRatePct ?? 'missing'}`,
  )

  if (!gate.allowUpgrade) {
    process.exit(1)
  }
}

main()
