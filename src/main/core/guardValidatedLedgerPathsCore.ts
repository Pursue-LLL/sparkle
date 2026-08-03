// [INPUT] homedir · fs exists/readdir
// [OUTPUT] discoverGuardValidatedLedgerPaths
// [POS] SSOT — legacy root + Cursor-2 profiles/<semver>/ validated-ledger paths.

import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export function guardLegacyRootDir(home: string = homedir()): string {
  return join(home, '.cursor-500-guard')
}

/** Legacy root + per-profile validated ledgers (Cursor-2 uses profiles/<semver>/). */
export function discoverGuardValidatedLedgerPaths(home: string = homedir()): string[] {
  const paths = new Set<string>()
  const root = guardLegacyRootDir(home)
  paths.add(join(root, 'runtime-events', 'validated-ledger.v1.jsonl'))
  const profilesDir = join(root, 'profiles')
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      paths.add(
        join(profilesDir, entry.name, 'runtime-events', 'validated-ledger.v1.jsonl'),
      )
    }
  }
  return [...paths]
}
