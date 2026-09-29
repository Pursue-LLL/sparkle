#!/usr/bin/env -S node --import tsx
/** Write .sparkle-build-meta.json into dist app Resources for agent install-only gate. */

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectCurrentBuildMeta,
  resolveDistBuildMetaPath,
  serializeBuildMeta,
} from './sparkleDistFreshnessCore'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')

function main(): number {
  const appPath = process.argv[2]
  if (!appPath) {
    console.error('[write-sparkle-dist-build-meta] FAIL: missing app path')
    return 1
  }

  const meta = collectCurrentBuildMeta(repoRoot)
  if (!meta) {
    console.error('[write-sparkle-dist-build-meta] FAIL: could not collect build meta')
    return 1
  }

  const metaPath = resolveDistBuildMetaPath(appPath)
  writeFileSync(metaPath, serializeBuildMeta(meta), 'utf8')
  console.error(
    `[write-sparkle-dist-build-meta] OK semver=${meta.semver} commit=${meta.gitCommit} stamp=${meta.buildStamp}`,
  )
  return 0
}

process.exit(main())
