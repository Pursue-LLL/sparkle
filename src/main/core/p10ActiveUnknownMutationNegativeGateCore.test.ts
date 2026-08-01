import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runP10ActiveUnknownMutationNegativeGate } from './p10ActiveUnknownMutationNegativeGateCore'
import { shouldDeferProfileProviderReload } from './appConfigMihomoReloadGuardCore'

describe('p10ActiveUnknownMutationNegativeGateCore P10-2', () => {
  it('defers profile provider reload under active lifecycle', () => {
    assert.equal(
      shouldDeferProfileProviderReload({
        quiesceActive: false,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 1,
      }),
      true,
    )
  })

  it('passes negative gate for inventoried mutation callers under active lifecycle', () => {
    const gate = runP10ActiveUnknownMutationNegativeGate()
    assert.equal(gate.ok, true, gate.cases.filter((c) => !c.ok).map((c) => c.caller).join(','))
    assert.ok(gate.inventoryModules >= 10)
  })
})
