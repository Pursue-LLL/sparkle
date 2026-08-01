import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  P10_DIAL_CAPABILITY_INVENTORY,
  discoverUnlistedDialMutationModules,
  runDialCapabilityInventoryAudit,
} from './dialCapabilityInventoryCore'

const SRC_MAIN = join(process.cwd(), 'src/main')

describe('dialCapabilityInventoryCore P10-2', () => {
  it('inventory covers wired non-production dial modules', () => {
    const modules = P10_DIAL_CAPABILITY_INVENTORY.map((entry) => entry.module)
    assert.ok(modules.includes('marathonRescueDialExecutor.ts'))
    assert.ok(modules.includes('marathonWarmthDialExecutor.ts'))
    assert.ok(modules.includes('marathonTransportDialOrchestrator.ts'))
    assert.ok(modules.includes('ipc.ts'))
  })

  it('passes static provenance audit for current codebase', () => {
    const result = runDialCapabilityInventoryAudit(SRC_MAIN)
    assert.equal(
      result.ok,
      true,
      [
        ...result.violations.map((v) => `${v.module}:${v.missingPattern}`),
        ...result.unlistedModules.map((m) => `unlisted:${m}`),
      ].join(', '),
    )
  })

  it('marathonQuiesce does not call mihomo reload', () => {
    const result = runDialCapabilityInventoryAudit(SRC_MAIN)
    assert.deepEqual(result.unlistedModules.filter((m) => m.includes('marathonQuiesce')), [])
  })

  it('discovers unlisted dial mutation modules when present', () => {
    const unlisted = discoverUnlistedDialMutationModules(SRC_MAIN)
    assert.ok(!unlisted.some((path) => path.endsWith('mihomoApi.ts')))
  })
})
