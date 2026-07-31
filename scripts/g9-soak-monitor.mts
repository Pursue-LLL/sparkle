#!/usr/bin/env tsx
/** G9 soak monitor — MaxStepsRate / RecoveryHonesty / early_disconnect from latest app log tail. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const LOG_DIR = path.join(homedir(), 'Library/Application Support/sparkle/logs')
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

function parseRatePct(line: string | null): number | null {
  if (!line) return null
  const match = line.match(/rate_pct(?:_24h)?=([\d.]+)/)
  return match ? Number(match[1]) : null
}

function main(): void {
  const logPath = latestAppLogPath()
  const tail = readFileSync(logPath, 'utf8').split('\n').slice(-TAIL_LINES)
  const maxSteps = pickLastMatching(tail, /\[MaxStepsRate\]:/)
  const recovery = pickLastMatching(tail, /\[RecoveryHonesty\]:/)
  const earlyDisconnect = maxSteps?.match(/early_disconnect=(\d+)/)?.[1] ?? 'unknown'
  const ratePct = parseRatePct(maxSteps)
  const recoveryOutcome = recovery?.match(/outcome=(\w+)/)?.[1] ?? 'unknown'

  const pass =
    earlyDisconnect === '0' &&
    ratePct !== null &&
    ratePct >= 90 &&
    (recoveryOutcome === 'success' || recoveryOutcome === 'unknown')

  console.log(`[G9Soak] log=${logPath}`)
  console.log(`[G9Soak] max_steps_rate=${maxSteps ?? 'missing'}`)
  console.log(`[G9Soak] recovery_honesty=${recovery ?? 'missing'}`)
  console.log(
    `[G9Soak] summary early_disconnect=${earlyDisconnect} rate_pct=${ratePct ?? 'missing'} recovery_outcome=${recoveryOutcome} pass=${pass ? '1' : '0'}`,
  )
  if (process.env.G9_SOAK_STRICT === '1' && !pass) {
    process.exit(1)
  }
}

main()
