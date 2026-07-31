#!/usr/bin/env tsx
/** Unified bundle verify — stage A (out/main) + optional stage B (app.asar). */
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  collectSparkleMainProcessAsarSource,
  collectSparkleMainProcessDiskSource,
} from './sparkleMainAsarSourceCore.ts'
import { assertSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore.ts'

const root = path.resolve(process.argv[2] ?? process.cwd())
const mainOutDir = path.join(root, 'out/main')
const asarPath = path.join(root, 'dist/mac-arm64/Sparkle.app/Contents/Resources/app.asar')
const withAsar =
  process.argv.includes('--with-asar') || process.env.SPARKLE_VERIFY_WITH_ASAR === '1'

function verifyStage(label: string, source: string): void {
  assertSparkleMainAsarBundle(source)
  console.log(`[verify-sparkle-bundle] OK ${label}`)
}

try {
  verifyStage(`stage=A dir=${mainOutDir}`, collectSparkleMainProcessDiskSource(mainOutDir))

  if (withAsar) {
    if (!existsSync(asarPath)) {
      console.error(`[verify-sparkle-bundle] FAIL: missing ${asarPath} (run build:mac first)`)
      process.exit(1)
    }
    verifyStage(`stage=B asar=${asarPath}`, collectSparkleMainProcessAsarSource(asarPath))
  }
} catch (err) {
  console.error(`[verify-sparkle-bundle] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
