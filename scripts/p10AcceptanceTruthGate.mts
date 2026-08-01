#!/usr/bin/env tsx
/** Gate A — acceptance truth (versions, extension roots, structured ledger counts). */
import path from 'node:path'
import {
  defaultP10AcceptanceTruthGateInput,
  runP10AcceptanceTruthGate,
} from '../src/main/core/p10AcceptanceTruthGateCore.ts'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const guardPkg =
  process.env.GUARD_PACKAGE_JSON ??
  path.resolve(ROOT, '../AI/open-perplexity/tools/cursor-usage-watch/package.json')

function main(): void {
  const input = defaultP10AcceptanceTruthGateInput(ROOT, guardPkg)
  const gate = runP10AcceptanceTruthGate(input)
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

main()
