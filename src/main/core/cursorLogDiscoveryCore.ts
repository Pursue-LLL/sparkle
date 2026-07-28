// [INPUT] homedir Application Support layout · optional cursorProxyAppPathPrefixes
// [OUTPUT] discoverCursorLogRoots · listCursorLogSessionDirs · auditCursorLogDiscoveryHealth
// [POS] P17 SSOT — replaces hardcoded Cursor-*-data paths for sync / token-gap / MTDO / triage.

import { existsSync, readdirSync } from 'fs'
import { realpathSync } from 'fs'
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { homedir } from 'os'

const MAX_LOG_SESSIONS = 6

export interface LogDiscoveryHealthResult {
  outcome: 'ok' | 'fail'
  rootsChecked: number
  sessionCount: number
  /** Dotfiles/files in logs/ that old scanners would mis-treat as session dirs. */
  strayEntries: string[]
  errors: string[]
}

/** Cursor/logs may contain dotfiles (e.g. .DS_Store); only session directories are valid. */
export async function listCursorLogSessionDirs(logsDir: string): Promise<string[]> {
  if (!existsSync(logsDir)) {
    return []
  }
  const sessionDirs: string[] = []
  for (const name of await readdir(logsDir)) {
    if (name.startsWith('.')) {
      continue
    }
    const sessionPath = join(logsDir, name)
    if (!existsSync(sessionPath)) {
      continue
    }
    const entryStat = await stat(sessionPath)
    if (!entryStat.isDirectory()) {
      continue
    }
    sessionDirs.push(name)
  }
  return sessionDirs.sort().slice(-Math.max(1, MAX_LOG_SESSIONS))
}

/** Startup / triage self-test: prove log session enumeration cannot ENOTDIR silently. */
export async function auditCursorLogDiscoveryHealth(options?: {
  appPathPrefixes?: readonly string[]
  applicationSupportDir?: string
}): Promise<LogDiscoveryHealthResult> {
  const roots = discoverCursorLogRoots(options)
  const strayEntries: string[] = []
  const errors: string[] = []
  let sessionCount = 0

  for (const root of roots) {
    const logsDir = join(root, 'logs')
    if (!existsSync(logsDir)) {
      continue
    }
    try {
      for (const name of await readdir(logsDir)) {
        const entryPath = join(logsDir, name)
        const entryStat = await stat(entryPath)
        if (entryStat.isDirectory()) {
          if (!name.startsWith('.')) {
            sessionCount += 1
          }
          continue
        }
        strayEntries.push(entryPath)
      }
      await listCursorLogSessionDirs(logsDir)
    } catch (error) {
      errors.push(
        `${logsDir}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const outcome = errors.length > 0 ? 'fail' : 'ok'
  return {
    outcome,
    rootsChecked: roots.length,
    sessionCount,
    strayEntries,
    errors,
  }
}

function applicationSupportDir(customDir?: string): string {
  return customDir ?? join(homedir(), 'Library', 'Application Support')
}

function cursorDataDirFromAppPrefix(appPrefix: string, supportDir: string): string {
  const appName = basename(appPrefix.trim())
  const stem = appName.endsWith('.app') ? appName.slice(0, -4) : appName
  return join(supportDir, `${stem}-data`)
}

function hasLogsTree(dirPath: string): boolean {
  return existsSync(join(dirPath, 'logs'))
}

function dedupeRealpaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    if (!hasLogsTree(path)) {
      continue
    }
    let key = path
    try {
      key = realpathSync(path)
    } catch {
      key = path
    }
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(path)
  }
  return out.sort()
}

/** Discover all local Cursor log roots (stock `Cursor/logs` and `Cursor-*-data/logs`). */
export function discoverCursorLogRoots(options?: {
  appPathPrefixes?: readonly string[]
  applicationSupportDir?: string
}): string[] {
  const supportDir = applicationSupportDir(options?.applicationSupportDir)
  const candidates: string[] = []

  for (const prefix of options?.appPathPrefixes ?? []) {
    if (!prefix.trim()) {
      continue
    }
    candidates.push(cursorDataDirFromAppPrefix(prefix, supportDir))
  }

  if (existsSync(supportDir)) {
    for (const entry of readdirSync(supportDir)) {
      if (!entry.startsWith('Cursor')) {
        continue
      }
      candidates.push(join(supportDir, entry))
    }
  }

  return dedupeRealpaths(candidates)
}
