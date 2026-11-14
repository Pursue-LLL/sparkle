import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMISSION_KBPS,
  advanceReview,
  classifyIncumbent,
  controlVetoes,
  DEGRADED_KBPS,
  isReviewDue,
  judgePrimaryForAdmission,
  MAX_WALK_CANDIDATES,
  planCandidateWalk,
  REVIEW_INTERVAL_MS,
  startReview,
  type ThroughputReading
} from './sparkleNodeQualityCore'

const NOW = 1_700_000_000_000
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS

const measured = (kbps: number): ThroughputReading => ({ kind: 'measured', kbps })
const FAILED: ThroughputReading = { kind: 'failed' }
const UNAVAILABLE: ThroughputReading = { kind: 'unavailable' }

describe('thresholds', () => {
  it('keeps the admission line above the degraded line so there is a dead band between them', () => {
    assert.ok(ADMISSION_KBPS > DEGRADED_KBPS)
  })
})

describe('judgePrimaryForAdmission', () => {
  it('admits from exactly the admission line up', () => {
    assert.equal(judgePrimaryForAdmission(measured(149)), 'reject')
    assert.equal(judgePrimaryForAdmission(measured(149.9)), 'reject')
    assert.equal(judgePrimaryForAdmission(measured(150)), 'pass')
    assert.equal(judgePrimaryForAdmission(measured(2000)), 'pass')
  })

  it('rejects a node that moved no data', () => {
    assert.equal(judgePrimaryForAdmission(measured(0)), 'reject')
    assert.equal(judgePrimaryForAdmission(FAILED), 'reject')
  })

  it('cannot judge when the probe machinery itself is unavailable', () => {
    assert.equal(judgePrimaryForAdmission(UNAVAILABLE), 'unknown')
  })
})

describe('controlVetoes', () => {
  it('vetoes only a control reading that was measured below the admission line', () => {
    assert.equal(controlVetoes(measured(149)), true)
    assert.equal(controlVetoes(measured(150)), false)
  })

  it('does not let an unreachable control site reject an otherwise good node', () => {
    assert.equal(controlVetoes(FAILED), false)
    assert.equal(controlVetoes(UNAVAILABLE), false)
  })
})

describe('classifyIncumbent', () => {
  it('calls a node degraded strictly below the degraded line', () => {
    assert.equal(classifyIncumbent(measured(99)), 'degraded')
    assert.equal(classifyIncumbent(measured(99.9)), 'degraded')
    assert.equal(classifyIncumbent(measured(100)), 'healthy')
    assert.equal(classifyIncumbent(measured(500)), 'healthy')
  })

  it('counts a node that moved no data as degraded', () => {
    assert.equal(classifyIncumbent(FAILED), 'degraded')
  })

  it('draws no conclusion when the probe machinery is unavailable', () => {
    assert.equal(classifyIncumbent(UNAVAILABLE), 'unknown')
  })

  it('keeps a pinned node that a new candidate could not replace: the dead band', () => {
    const reading = measured(120)

    assert.equal(classifyIncumbent(reading), 'healthy')
    assert.equal(judgePrimaryForAdmission(reading), 'reject')
  })
})

describe('review schedule', () => {
  it('first reviews a freshly pinned node after the review interval', () => {
    assert.deepEqual(startReview('台湾-1', NOW), {
      node: '台湾-1',
      dueAtMs: NOW + REVIEW_INTERVAL_MS,
      firstDegradedAtMs: 0
    })
  })

  it('takes a custom first delay', () => {
    assert.equal(startReview('台湾-1', NOW, 10 * MINUTE_MS).dueAtMs, NOW + 10 * MINUTE_MS)
  })

  it('is due from the scheduled time on', () => {
    const state = startReview('台湾-1', NOW)

    assert.equal(isReviewDue(state, NOW + REVIEW_INTERVAL_MS - 1), false)
    assert.equal(isReviewDue(state, NOW + REVIEW_INTERVAL_MS), true)
  })
})

describe('advanceReview', () => {
  const due = (): ReturnType<typeof startReview> => startReview('台湾-1', NOW)
  const at = NOW + REVIEW_INTERVAL_MS

  it('schedules the next review a full interval later when the node is healthy', () => {
    const { state, degraded } = advanceReview(due(), 'healthy', at)

    assert.equal(degraded, false)
    assert.deepEqual(state, startReview('台湾-1', at))
  })

  it('asks for a confirming reading 45 seconds after the first degraded one', () => {
    const { state, degraded } = advanceReview(due(), 'degraded', at)

    assert.equal(degraded, false)
    assert.deepEqual(state, { node: '台湾-1', dueAtMs: at + 45 * SECOND_MS, firstDegradedAtMs: at })
  })

  it('confirms degradation when the second degraded reading comes at least 45 seconds later', () => {
    const first = advanceReview(due(), 'degraded', at).state

    const second = advanceReview(first, 'degraded', at + 45 * SECOND_MS)

    assert.equal(second.degraded, true)
  })

  it('does not count a second reading that is too close to the first', () => {
    const first = advanceReview(due(), 'degraded', at).state

    const second = advanceReview(first, 'degraded', at + 45 * SECOND_MS - 1)

    assert.equal(second.degraded, false)
    assert.equal(second.state.firstDegradedAtMs, at + 45 * SECOND_MS - 1)
  })

  it('confirms up to five minutes after the first reading, and starts over after that', () => {
    const first = advanceReview(due(), 'degraded', at).state

    assert.equal(advanceReview(first, 'degraded', at + 5 * MINUTE_MS).degraded, true)
    const stale = advanceReview(first, 'degraded', at + 5 * MINUTE_MS + 1)

    assert.equal(stale.degraded, false)
    assert.equal(stale.state.firstDegradedAtMs, at + 5 * MINUTE_MS + 1)
  })

  it('forgets a degraded reading once the node reads healthy again', () => {
    const first = advanceReview(due(), 'degraded', at).state

    const recovered = advanceReview(first, 'healthy', at + 45 * SECOND_MS)
    const later = advanceReview(recovered.state, 'degraded', at + 2 * REVIEW_INTERVAL_MS)

    assert.equal(recovered.state.firstDegradedAtMs, 0)
    assert.equal(later.degraded, false)
  })

  it('retries an inconclusive reading later without losing the first degraded one', () => {
    const first = advanceReview(due(), 'degraded', at).state

    const unknown = advanceReview(first, 'unknown', at + 45 * SECOND_MS)

    assert.equal(unknown.degraded, false)
    assert.equal(unknown.state.dueAtMs, at + 45 * SECOND_MS + 5 * MINUTE_MS)
    assert.equal(unknown.state.firstDegradedAtMs, at)
  })

  it('needs a first degraded reading to confirm, whatever the clock says', () => {
    const noFirstReading = { node: '台湾-1', dueAtMs: 0, firstDegradedAtMs: 0 }

    const outcome = advanceReview(noFirstReading, 'degraded', MINUTE_MS)

    assert.equal(outcome.degraded, false)
    assert.equal(outcome.state.firstDegradedAtMs, MINUTE_MS)
  })

  it('never confirms on the strength of an inconclusive reading', () => {
    assert.equal(advanceReview(due(), 'unknown', at).degraded, false)
  })

  it('keeps the node it reviews in every outcome', () => {
    for (const health of ['healthy', 'degraded', 'unknown'] as const) {
      assert.equal(advanceReview(due(), health, at).state.node, '台湾-1')
    }
  })
})

describe('planCandidateWalk', () => {
  const alive = (...names: string[]): ReadonlySet<string> => new Set(names)

  it('tries the current candidate first, then the alive nodes in file order', () => {
    assert.deepEqual(
      planCandidateWalk({
        first: 'B',
        order: ['A', 'B', 'C', 'D'],
        alive: alive('A', 'B', 'C', 'D'),
        sunk: alive()
      }),
      ['B', 'A', 'C', 'D']
    )
  })

  it('leaves out nodes that are not known to be alive', () => {
    assert.deepEqual(
      planCandidateWalk({ order: ['A', 'B', 'C'], alive: alive('A', 'C'), sunk: alive() }),
      ['A', 'C']
    )
  })

  it('never tries a sunk node, not even as the current candidate', () => {
    assert.deepEqual(
      planCandidateWalk({
        first: 'A',
        order: ['A', 'B', 'C'],
        alive: alive('A', 'B', 'C'),
        sunk: alive('A', 'C')
      }),
      ['B']
    )
  })

  it('leaves out the node under review', () => {
    assert.deepEqual(
      planCandidateWalk({
        order: ['A', 'B', 'C'],
        alive: alive('A', 'B', 'C'),
        sunk: alive(),
        exclude: 'A'
      }),
      ['B', 'C']
    )
  })

  it('tries each node once', () => {
    assert.deepEqual(
      planCandidateWalk({
        first: 'A',
        order: ['A', 'A', 'B'],
        alive: alive('A', 'B'),
        sunk: alive()
      }),
      ['A', 'B']
    )
  })

  it('stops at the walk limit, counting the current candidate', () => {
    const order = Array.from({ length: 20 }, (_, index) => `N${index}`)

    const walk = planCandidateWalk({ first: 'N5', order, alive: alive(...order), sunk: alive() })

    assert.equal(walk.length, MAX_WALK_CANDIDATES)
    assert.deepEqual(walk.slice(0, 3), ['N5', 'N0', 'N1'])
  })

  it('has nothing to try when every node is dead or sunk', () => {
    assert.deepEqual(
      planCandidateWalk({
        first: 'A',
        order: ['A', 'B'],
        alive: alive('A'),
        sunk: alive('A', 'B')
      }),
      []
    )
  })
})
