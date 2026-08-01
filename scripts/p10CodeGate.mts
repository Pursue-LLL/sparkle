#!/usr/bin/env tsx
/** P10-6/7 full pre-deploy code gate — §M.0.15.11.8 matrix (frozen fixtures + invariant proofs). */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function printMatrixSummary(): Promise<boolean> {
  const base = pathToFileURL(path.join(ROOT, 'src/main/core/')).href
  const { runP10ReplayGate } = await import(new URL('p10ReplayGateCore.ts', base).href)
  const { runP10FaultInjectionGate } = await import(new URL('p10FaultInjectionGateCore.ts', base).href)
  const { runP10ParallelComposerGate } = await import(new URL('p10ParallelComposerGateCore.ts', base).href)
  const { runP10ConsumerFaultGate } = await import(new URL('p10ConsumerFaultGateCore.ts', base).href)
  const { runP10StockParityGate } = await import(new URL('p10StockParityGateCore.ts', base).href)
  const { runP10TunLatencyGate } = await import(new URL('p10TunLatencyGateCore.ts', base).href)

  const replay = runP10ReplayGate()
  const fault = runP10FaultInjectionGate()
  const parallel = runP10ParallelComposerGate()
  const consumer = runP10ConsumerFaultGate()
  const stock = runP10StockParityGate()
  const tun = runP10TunLatencyGate()
  const matrixOk =
    replay.nextGateAllowed &&
    fault.ok &&
    parallel.ok &&
    consumer.ok &&
    stock.ok &&
    tun.ok

  console.log('[P10CodeGate]: matrix summary')
  console.log(`  replay: ${replay.nextGateAllowed ? 'PASS' : 'FAIL'}`)
  console.log(`  fault: ${fault.ok ? 'PASS' : 'FAIL'} (${fault.cases.length} cases)`)
  console.log(
    `  parallel: ${parallel.ok ? 'PASS' : 'FAIL'} (${parallel.cases.map((c) => c.composerCount).join('/')})`,
  )
  console.log(`  consumer: ${consumer.ok ? 'PASS' : 'FAIL'} (${consumer.cases.length} cases)`)
  console.log(`  stock_parity: ${stock.ok ? 'PASS' : 'FAIL'} (${stock.cases.length} metrics)`)
  console.log(`  tun_tax: ${tun.ok ? 'PASS' : 'FAIL'} — ${tun.detail}`)
  return matrixOk
}

function main(): void {
  const tests = [
    'src/main/core/p10BaselineFixturesCore.test.ts',
    'src/main/core/p10AcceptanceTruthGateCore.test.ts',
    'src/main/core/p10ReplayGateCore.test.ts',
    'src/main/core/p10FaultInjectionGateCore.test.ts',
    'src/main/core/p10FullMatrixGateCore.test.ts',
    'src/main/core/p10ActiveUnknownMutationNegativeGateCore.test.ts',
    'src/main/core/dialCapabilityInventoryCore.test.ts',
  ]
  console.log('[P10CodeGate]: running §M.0.15.11.8 full matrix tests')
  const result = spawnSync('npx', ['tsx', '--test', ...tests], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error('[P10CodeGate]: FAIL — code gates block soak')
    process.exit(result.status ?? 1)
  }

  void printMatrixSummary().then((matrixOk) => {
    if (!matrixOk) {
      console.error('[P10CodeGate]: FAIL — matrix invariant proof incomplete')
      process.exit(1)
    }
    console.log('[P10CodeGate]: PASS — frozen matrix green; runtime soak still requires deploy + physical ingest')
  })
}

main()
