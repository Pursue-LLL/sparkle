#!/usr/bin/env -S node --import tsx
/** Exit 0 when dist matches current source fingerprint; exit 1 when stale (force full rebuild). */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectCurrentBuildMeta,
  evaluateDistFreshness,
  readDistBuildMeta,
} from './sparkleDistFreshnessCore'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')

function main(): number {
  const appPath = process.argv[2]
  if (!appPath || !existsSync(appPath)) {
    console.error('[DistFreshness] FAIL: missing dist app path argument')
    return 2
  }

  const current = collectCurrentBuildMeta(repoRoot)
  if (!current) {
    console.error('[DistFreshness] FAIL: could not collect current build meta from repo')
    return 2
  }

  const distMeta = readDistBuildMeta(appPath)
  const evaluation = evaluateDistFreshness({ distMeta, current })

  if (evaluation.fresh) {
    console.error(
      `[DistFreshness] fresh=1 reason=${evaluation.reason} semver=${current.semver} commit=${current.gitCommit}`,
    )
    return 0
  }

  console.error(
    `[DistFreshness] fresh=0 reason=${evaluation.reason} dist_commit=${distMeta?.gitCommit ?? 'none'} current_commit=${current.gitCommit}`,
  )
  return 1
}

process.exit(main())
