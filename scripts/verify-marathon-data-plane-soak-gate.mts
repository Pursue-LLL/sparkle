#!/usr/bin/env tsx
/** P3 soak gate — after marathon guard defer events, zero mihomo cold starts while cursor_conn>0. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SOAK_WINDOW_MS = 30 * 60 * 1000
const GUARD_T0_MARKERS = [
  'deferred data_plane_mutation_blocked',
  'core_cold_restart_blocked caller=profile-update-cli',
  'core_start_blocked reason=',
]

const CORE_START_MARKERS = [
  'mihomo core started',
  'core_cold_restart_scheduled caller=profile-update-cli',
  'core_cold_restart_scheduled caller=startCore',
]

function fail(msg: string): never {
  console.error(`[verify-marathon-data-plane-soak-gate] FAIL: ${msg}`)
  process.exit(1)
}

function resolveSparkleLogDir(): string {
  if (process.env.SPARKLE_LOG_DIR) {
    return process.env.SPARKLE_LOG_DIR
  }

  const candidates = [
    join('/Users', process.env.USER ?? '', 'Library/Application Support/sparkle/logs'),
    join(homedir(), 'Library/Application Support/sparkle/logs'),
  ].filter((candidate) => candidate.length > 0)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] ?? join(homedir(), 'Library/Application Support/sparkle/logs')
}

function latestLog(prefix: string): string | null {
  const dir = resolveSparkleLogDir()
  let latest: { path: string; mtime: number } | null = null
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(`${prefix}-`) || !name.endsWith('.log')) {
      continue
    }
    const path = join(dir, name)
    const mtime = statSync(path).mtimeMs
    if (!latest || mtime > latest.mtime) {
      latest = { path, mtime }
    }
  }
  return latest?.path ?? null
}

function parseLogTimestamp(line: string): number | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
  if (!match?.[1]) {
    return null
  }
  const ms = Date.parse(match[1])
  return Number.isFinite(ms) ? ms : null
}

function findGuardT0Ms(lines: string[]): number {
  for (const line of lines) {
    if (GUARD_T0_MARKERS.some((marker) => line.includes(marker))) {
      const ts = parseLogTimestamp(line)
      if (ts !== null) {
        return ts
      }
    }
  }
  return Date.now() - SOAK_WINDOW_MS
}

function auditLogFile(path: string, t0Ms: number, label: string): string[] {
  const violations: string[] = []
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split('\n')) {
    const ts = parseLogTimestamp(line)
    if (ts === null || ts < t0Ms) {
      continue
    }
    if (CORE_START_MARKERS.some((marker) => line.includes(marker))) {
      violations.push(`${label}: ${line.trim()}`)
    }
    if (line.includes('[ProfileUpdaterCli]: bootstrap start')) {
      const tail = content.split('\n')
      const idx = tail.indexOf(line)
      const nextLines = tail.slice(idx, idx + 5).join('\n')
      if (
        !nextLines.includes('deferred data_plane_mutation_blocked') &&
        !nextLines.includes('core_cold_restart_blocked caller=profile-update-cli')
      ) {
        violations.push(`${label}: unguarded ProfileUpdaterCli bootstrap after T0: ${line.trim()}`)
      }
    }
  }
  return violations
}

function main(): void {
  const minutesArg = process.argv.find((arg) => arg.startsWith('--minutes='))
  const windowMs = minutesArg
    ? Math.max(1, Number(minutesArg.split('=')[1] ?? '30')) * 60 * 1000
    : SOAK_WINDOW_MS

  const appLog = latestLog('app')
  if (!appLog) {
    fail('app log not found')
  }

  const appLines = readFileSync(appLog, 'utf-8').split('\n')
  const t0Ms = Math.max(findGuardT0Ms(appLines), Date.now() - windowMs)

  const violations: string[] = []
  violations.push(...auditLogFile(appLog, t0Ms, 'app'))

  const coreLog = latestLog('core')
  if (coreLog) {
    violations.push(...auditLogFile(coreLog, t0Ms, 'core'))
  }

  const deferCount = appLines.filter(
    (line) =>
      parseLogTimestamp(line) !== null &&
      (parseLogTimestamp(line) ?? 0) >= t0Ms &&
      line.includes('deferred data_plane_mutation_blocked'),
  ).length

  if (deferCount === 0) {
    fail(`no defer events in soak window — run ProfileUpdaterCli while Cursor active (t0=${new Date(t0Ms).toISOString()})`)
  }

  if (violations.length > 0) {
    fail(violations.join('\n'))
  }

  console.log(
    `[verify-marathon-data-plane-soak-gate] PASS t0=${new Date(t0Ms).toISOString()} defer_events=${deferCount} window_min=${Math.round(windowMs / 60000)}`,
  )
}

main()
