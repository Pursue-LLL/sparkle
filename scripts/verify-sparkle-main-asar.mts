#!/usr/bin/env tsx
/** CLI wrapper for upgradeSparkleAsarGateCore — used by upgrade-sparkle-local.sh */
import asar from '@electron/asar'
import { assertSparkleMainAsarBundle } from './upgradeSparkleAsarGateCore.ts'

const appAsar = process.argv[2]
if (!appAsar) {
  console.error('[verify-sparkle-main-asar] usage: verify-sparkle-main-asar.mts <path/to/app.asar>')
  process.exit(1)
}

const mainRel = 'out/main/index.js'
let src = ''
try {
  src = asar.extractFile(appAsar, mainRel).toString('utf8')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error(`[verify-sparkle-main-asar] asar missing ${mainRel}:`, msg)
  process.exit(1)
}

try {
  assertSparkleMainAsarBundle(src)
} catch (err) {
  console.error(`[upgrade-sparkle] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
