#!/usr/bin/env tsx
/** Gate A — acceptance truth (versions, extension roots, structured ledger counts). */
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const home = homedir()
const guardPkg =
  process.env.GUARD_PACKAGE_JSON ??
  path.resolve(ROOT, '../../AI/open-perplexity/tools/cursor-usage-watch/package.json')

async function main(): Promise<void> {
  const corePath = pathToFileURL(
    join(ROOT, 'src/main/core/p10AcceptanceTruthGateCore.ts'),
  ).href
  const mod = await import(corePath)
  const input = {
    sparklePackageJsonPath: join(ROOT, 'package.json'),
    guardPackageJsonPath: guardPkg,
    validatedLedgerPath: join(home, '.cursor-500-guard', 'runtime-events', 'validated-ledger.v1.jsonl'),
    cursorProfileExtensionRoots: [
      join(home, '.cursor-3.1.15', 'extensions'),
      join(home, '.cursor', 'extensions'),
    ],
    sparkleAppInfoPath: '/Applications/Sparkle.app/Contents/Info.plist',
  }
  const gate = mod.runP10AcceptanceTruthGate(input)
  console.log('[P10AcceptanceTruthGate]: ledger counts', gate.ledgerCounts)
  console.log(
    `[P10AcceptanceTruthGate]: sparkle=${gate.sparklePackageVersion ?? '?'} installed=${gate.installedSparkleVersion ?? '?'}`,
  )
  console.log(
    `[P10AcceptanceTruthGate]: guard=${gate.guardPackageVersion ?? '?'} installed=${gate.installedGuardVersions.join(',') || '?'}`,
  )
  for (const item of gate.cases) {
    console.log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`)
  }
  if (!gate.ok) {
    console.error('[P10AcceptanceTruthGate]: FAIL — fix truth gate before deploy request')
    process.exit(1)
  }
  console.log('[P10AcceptanceTruthGate]: PASS')
}

void main()
