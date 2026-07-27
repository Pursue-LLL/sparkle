// [INPUT] homedir Application Support layout · optional cursorProxyAppPathPrefixes
// [OUTPUT] discoverCursorLogRoots: every Cursor install dir that owns a logs/ tree
// [POS] P17 SSOT — replaces hardcoded Cursor-*-data paths for sync / token-gap / MTDO / triage.

import { existsSync, readdirSync } from 'fs'
import { realpathSync } from 'fs'
import { basename, join } from 'path'
import { homedir } from 'os'

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
