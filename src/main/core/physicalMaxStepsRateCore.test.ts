import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computePhysicalMaxStepsRateSnapshot,
  evaluatePhysicalRulerValidity,
} from './physicalMaxStepsRateCore'
import { P10_BAD_RULER_FIXTURE } from './p10BaselineFixturesCore'

describe('physicalMaxStepsRateCore P10-5', () => {
  it('invalidates ruler when ledger has segments but zero network_started', () => {
    const validity = evaluatePhysicalRulerValidity({
      networkStartedCount: 0,
      ledgerHttpSegmentStarted: P10_BAD_RULER_FIXTURE.ledgerHttpSegmentStarted,
    })
    assert.equal(validity.valid, false)
    assert.equal(validity.invalidReason, 'bad_ruler_no_network_started')
  })

  it('computes rolling100 physical rate only when cohort fully closed', () => {
    const starts = Array.from({ length: 100 }, (_, index) => ({
      networkStartId: `ns-${index}`,
      rendererBootId: 'boot-1',
      startedAtMs: 1_000_000 + index,
      outcome: (index < 90 ? 'max_steps' : 'transport_error') as const,
      closedAtMs: 1_000_100 + index,
    }))
    const snapshot = computePhysicalMaxStepsRateSnapshot({ starts })
    assert.equal(snapshot.valid, true)
    assert.equal(snapshot.closedCount, 100)
    assert.equal(snapshot.maxStepsCount, 90)
    assert.equal(snapshot.physicalRatePct, 90)
    assert.equal(snapshot.belowTarget, false)
  })

  it('marks snapshot invalid when cohort has in-progress starts', () => {
    const snapshot = computePhysicalMaxStepsRateSnapshot({
      starts: [
        {
          networkStartId: 'ns-1',
          rendererBootId: 'boot-1',
          startedAtMs: 1,
          outcome: 'max_steps',
          closedAtMs: 2,
        },
        {
          networkStartId: 'ns-2',
          rendererBootId: 'boot-1',
          startedAtMs: 3,
          outcome: 'in_progress',
        },
      ],
    })
    assert.equal(snapshot.valid, false)
    assert.equal(snapshot.invalidReason, 'incomplete_outcomes_in_cohort')
  })
})
