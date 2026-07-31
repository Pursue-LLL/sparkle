#!/usr/bin/env tsx
/** Stage-A bundle gate — scan out/main/*.js before electron-builder (fail-fast ~30s). */
import path from 'node:path'
import { collectSparkleMainProcessDiskSource } from './sparkleMainAsarSourceCore.ts'
import { assertSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore.ts'

const mainOutDir = path.resolve(process.argv[2] ?? 'out/main')

try {
  const src = collectSparkleMainProcessDiskSource(mainOutDir)
  assertSparkleMainAsarBundle(src)
  console.log(`[verify-sparkle-main-bundle] OK stage=A dir=${mainOutDir}`)
} catch (err) {
  console.error(`[verify-sparkle-main-bundle] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
