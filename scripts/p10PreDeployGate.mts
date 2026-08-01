#!/usr/bin/env tsx
/** P10 pre-deploy composite gate — §M.0.15.13 code layer vs artifact layer. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function main(): Promise<void> {
  const mod = await import(
    pathToFileURL(path.join(ROOT, 'src/main/core/p10PreDeployGateCore.ts')).href
  )
  const gate = mod.runP10PreDeployGate(mod.defaultP10PreDeploySrcMainRoot(ROOT))
  console.log('[P10PreDeployGate]: summary')
  for (const item of gate.cases) {
    const label = item.blocked ? 'BLOCKED' : item.ok ? 'PASS' : 'FAIL'
    console.log(`  ${label} ${item.name}: ${item.detail}`)
  }
  console.log(`[P10PreDeployGate]: code_layer=${gate.codeLayerOk ? 'PASS' : 'FAIL'}`)
  console.log(`[P10PreDeployGate]: next_gate_allowed=${gate.nextGateAllowed ? 'YES' : 'NO'}`)
  if (!gate.codeLayerOk) {
    process.exit(1)
  }
}

void main()
