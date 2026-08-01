import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runP10FaultInjectionGate } from './p10FaultInjectionGateCore'
import { runP10ReplayGate } from './p10ReplayGateCore'

describe('p10FaultInjectionGateCore P10-6', () => {
  it('passes lifecycle reorder/drop and admission fault cases', () => {
    const gate = runP10FaultInjectionGate()
    assert.equal(gate.ok, true, gate.cases.filter((c) => !c.ok).map((c) => c.name).join(','))
  })

  it('chains replay gate before fault gate (no skip-level)', () => {
    const replay = runP10ReplayGate()
    const fault = runP10FaultInjectionGate()
    assert.equal(replay.nextGateAllowed, true)
    assert.equal(fault.ok, true)
  })
})
