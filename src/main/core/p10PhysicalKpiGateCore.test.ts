import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runP10PhysicalKpiGate, runP10PhysicalKpiGateForBaselineFixture } from './p10PhysicalKpiGateCore'

describe('p10PhysicalKpiGateCore P10-5', () => {
  it('FAILs baseline bad ruler (network_started=0, http_segment>0)', () => {
    const gate = runP10PhysicalKpiGateForBaselineFixture()
    assert.equal(gate.ok, false)
    assert.equal(gate.snapshot.invalidReason, 'bad_ruler_no_network_started')
  })

  it('PASSes when rolling100 cohort fully closed at 90%+ max_steps', () => {
    const starts = Array.from({ length: 100 }, (_, index) => ({
      networkStartId: `net:${index}`,
      rendererBootId: 'boot-1',
      startedAtMs: index * 1000,
      outcome: index < 90 ? ('max_steps' as const) : ('transport_error' as const),
      closedAtMs: index * 1000 + 500,
    }))
    const gate = runP10PhysicalKpiGate({
      starts,
      ledgerHttpSegmentStarted: 100,
    })
    assert.equal(gate.ok, true)
    assert.equal(gate.snapshot.physicalRatePct, 90)
  })
})
