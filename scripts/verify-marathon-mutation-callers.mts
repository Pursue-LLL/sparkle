#!/usr/bin/env tsx
/** P1 CI gate — every startCore/restartCore caller must be allowlisted; reload scripts must read marathon guard. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const SCAN_ROOTS = ['src/main', 'scripts'] as const

const START_CORE_ALLOWLIST = new Set([
  'src/main/core/manager.ts',
  'src/main/core/coreReadinessGate.ts',
  'src/main/core/profileUpdateDueCli.ts',
  'src/main/index.ts',
  'src/main/sys/macos26HeadlessBootstrap.ts',
])

const RESTART_CORE_ALLOWLIST = new Set([
  'src/main/core/manager.ts',
  'src/main/core/recoveryCircuitBreaker.ts',
  'src/main/config/profile.ts',
  'src/main/core/cursorTransportHealth.ts',
  'src/main/core/mihomoApiSocketWatchdog.ts',
  'src/main/core/tunStartupGuard.ts',
  'src/main/resolve/tray.ts',
  'src/main/resolve/shortcut.ts',
])

const RELOAD_SCRIPT_GUARD_MARKERS = [
  'marathon-core-restart-guard.json',
  'shouldDeferFromGuardPayload',
  'shouldDeferMihomoReloadFromGuardStateFile',
]

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const rel = path.relative(ROOT, full).replaceAll('\\', '/')
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') {
      continue
    }
    const st = statSync(full)
    if (st.isDirectory()) {
      collectSourceFiles(full, acc)
      continue
    }
    if (/\.(ts|tsx|mts|mjs)$/.test(entry)) {
      acc.push(rel)
    }
  }
  return acc
}

function findCallSites(content: string, pattern: RegExp): number[] {
  const lines: number[] = []
  const rows = content.split('\n')
  for (let i = 0; i < rows.length; i += 1) {
    if (pattern.test(rows[i] ?? '')) {
      lines.push(i + 1)
    }
  }
  return lines
}

function fail(msg: string): never {
  console.error(`[verify-marathon-mutation-callers] FAIL: ${msg}`)
  process.exit(1)
}

const violations: string[] = []

for (const scanRoot of SCAN_ROOTS) {
  for (const rel of collectSourceFiles(path.join(ROOT, scanRoot))) {
    const content = readFileSync(path.join(ROOT, rel), 'utf-8')

    if (rel.endsWith('verify-marathon-mutation-callers.mts')) {
      continue
    }

    if (/(?<![.\w])startCore\s*\(/.test(content) && !START_CORE_ALLOWLIST.has(rel)) {
      const lines = findCallSites(content, /(?<![.\w])startCore\s*\(/)
      violations.push(`${rel}:${lines.join(',')} unallowlisted startCore(`)
    }

    if (/(?<![.\w])restartCore\s*\(/.test(content) && !RESTART_CORE_ALLOWLIST.has(rel)) {
      const lines = findCallSites(content, /(?<![.\w])restartCore\s*\(/)
      violations.push(`${rel}:${lines.join(',')} unallowlisted restartCore(`)
    }

    if (rel.startsWith('scripts/') && /configs\?force=true|force=true/.test(content)) {
      const hasGuard = RELOAD_SCRIPT_GUARD_MARKERS.some((marker) => content.includes(marker))
      if (!hasGuard) {
        violations.push(`${rel} force reload without marathon guard marker`)
      }
    }
  }
}

if (violations.length > 0) {
  fail(violations.join('\n'))
}

console.log('[verify-marathon-mutation-callers] OK allowlisted startCore/restartCore + reload guard markers')
