#!/usr/bin/env tsx
/** P10-6/7 code gate — frozen replay + fault injection before runtime soak. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

function main(): void {
  const tests = [
    'src/main/core/p10ReplayGateCore.test.ts',
    'src/main/core/p10FaultInjectionGateCore.test.ts',
    'src/main/core/dialCapabilityInventoryCore.test.ts',
  ]
  console.log('[P10CodeGate]: running frozen replay + fault injection tests')
  const result = spawnSync('npx', ['tsx', '--test', ...tests], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error('[P10CodeGate]: FAIL — code gates block soak')
    process.exit(result.status ?? 1)
  }
  console.log('[P10CodeGate]: PASS — runtime soak (G9 strict) may proceed')
}

main()
