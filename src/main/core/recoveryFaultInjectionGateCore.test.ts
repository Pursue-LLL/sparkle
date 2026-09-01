import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runRecoveryFaultInjectionGate } from './recoveryFaultInjectionGateCore'

describe('recoveryFaultInjectionGateCore @phase1', () => {
  it('passes recovery fault injection matrix', () => {
    const result = runRecoveryFaultInjectionGate()
    for (const item of result.cases) {
      assert.equal(item.ok, true, `${item.name}: ${item.detail}`)
    }
    assert.equal(result.ok, true)
  })
})
