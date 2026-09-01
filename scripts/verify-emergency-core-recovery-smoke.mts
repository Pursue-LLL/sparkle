#!/usr/bin/env tsx
/**
 * Live smoke: run Sparkle --sparkle-emergency-recovery-smoke and assert app log markers.
 * Usage: tsx scripts/verify-emergency-core-recovery-smoke.mts
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SPARKLE_BIN =
  process.env.SPARKLE_SMOKE_BIN ??
  (existsSync('/Users/yululiu/projects/OpenSource/sparkle/dist/mac-arm64/Sparkle.app/Contents/MacOS/Sparkle')
    ? '/Users/yululiu/projects/OpenSource/sparkle/dist/mac-arm64/Sparkle.app/Contents/MacOS/Sparkle'
    : '/Applications/Sparkle.app/Contents/MacOS/Sparkle')
const LOG_DIR = join(homedir(), 'Library/Application Support/sparkle/logs')

function latestAppLogPath(): string {
  const files = readdirSync(LOG_DIR)
    .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
    .map((f) => ({ f, m: statSync(join(LOG_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return join(LOG_DIR, files[0]?.f ?? 'app.log')
}

function lineCount(path: string): number {
  if (!existsSync(path)) {
    return 0
  }
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length
}

function main(): void {
  if (!existsSync(SPARKLE_BIN)) {
    console.error(`FAIL: missing ${SPARKLE_BIN}`)
    process.exit(1)
  }

  const logPath = latestAppLogPath()
  const sinceLine = lineCount(logPath)
  console.error(`[emergency-smoke] log=${logPath} since_line=${sinceLine}`)

  try {
    execFileSync('pkill', ['-x', 'Sparkle'], { stdio: 'ignore' })
  } catch {
    // ignore — Sparkle may not be running
  }
  try {
    execFileSync('bash', ['-lc', 'launchctl bootout gui/$(id -u)/com.sparkle.gui-watchdog 2>/dev/null; true'], {
      stdio: 'ignore',
    })
  } catch {
    // ignore
  }
  execFileSync('sleep', ['3'])

  try {
    execFileSync(SPARKLE_BIN, ['--sparkle-emergency-recovery-smoke'], {
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const err = error as { stderr?: Buffer; message?: string }
    console.error(`[emergency-smoke] Sparkle CLI exit non-zero: ${err.stderr?.toString() ?? err.message ?? error}`)
  }

  const text = readFileSync(logPath, 'utf8')
  const tail = text.trim().split('\n').slice(sinceLine)
  const joined = tail.join('\n')

  const failures: string[] = []
  if (joined.includes('is not a function')) {
    failures.push('is_not_a_function in post-smoke log')
  }
  if (joined.includes('emergency_core_restart_handler_unregistered')) {
    failures.push('handler_unregistered')
  }
  if (!joined.includes('[EmergencyRecoverySmoke]: outcome=PASS') &&
    !joined.includes('[EmergencyRecoverySmoke]: second-instance completed')) {
    failures.push('missing EmergencyRecoverySmoke PASS marker')
  }
  if (!joined.includes('emergency_core_recovery_completed')) {
    failures.push('missing emergency_core_recovery_completed')
  }

  if (failures.length > 0) {
    console.error(`EMERGENCY_RECOVERY_SMOKE: FAIL ${failures.join('; ')}`)
    console.error(tail.slice(-20).join('\n'))
    process.exit(1)
  }

  console.log('EMERGENCY_RECOVERY_SMOKE: PASS')
}

main()
