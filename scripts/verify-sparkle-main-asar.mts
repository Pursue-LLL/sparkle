#!/usr/bin/env tsx
/** CLI wrapper for upgradeSparkleAsarGateCore — used by upgrade-sparkle-local.sh */
import { collectSparkleMainProcessAsarSource } from './sparkleMainAsarSourceCore.ts'
import { assertSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore.ts'

const appAsar = process.argv[2]
if (!appAsar) {
  console.error('[verify-sparkle-main-asar] usage: verify-sparkle-main-asar.mts <path/to/app.asar>')
  process.exit(1)
}

let src = ''
try {
  src = collectSparkleMainProcessAsarSource(appAsar)
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(`[verify-sparkle-main-asar] ${msg}`)
  process.exit(1)
}

try {
  assertSparkleMainAsarBundle(src)
  console.log(`[verify-sparkle-main-asar] OK stage=B asar=${appAsar}`)
} catch (err) {
  console.error(`[upgrade-sparkle] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
