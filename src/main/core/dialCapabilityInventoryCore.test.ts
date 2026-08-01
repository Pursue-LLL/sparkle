import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  auditDialCapabilityInventory,
  P10_DIAL_CAPABILITY_INVENTORY,
} from './dialCapabilityInventoryCore'

const CORE_DIR = join(process.cwd(), 'src/main/core')

function readCoreModule(fileName: string): string {
  return readFileSync(join(CORE_DIR, fileName), 'utf8')
}

describe('dialCapabilityInventoryCore P10-2', () => {
  it('inventory covers all wired non-production dial modules', () => {
    const modules = P10_DIAL_CAPABILITY_INVENTORY.map((entry) => entry.module)
    assert.ok(modules.includes('marathonRescueDialExecutor.ts'))
    assert.ok(modules.includes('marathonTransportDialOrchestrator.ts'))
    assert.ok(modules.includes('marathonQuiesce.ts'))
  })

  it('passes static provenance audit for current codebase', () => {
    const sources: Record<string, string> = {}
    for (const entry of P10_DIAL_CAPABILITY_INVENTORY) {
      sources[entry.module] = readCoreModule(entry.module)
    }
    const result = auditDialCapabilityInventory(sources)
    assert.equal(
      result.ok,
      true,
      result.violations.map((v) => `${v.module}:${v.missingPattern}`).join(', '),
    )
  })

  it('marathonQuiesce does not call mihomo reload', () => {
    const source = readCoreModule('marathonQuiesce.ts')
    assert.doesNotMatch(source, /reloadMihomoConfigFromDisk/)
  })
})
