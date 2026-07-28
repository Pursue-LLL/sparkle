import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MARATHON_OBSERVABILITY_DIAL_CONN_THRESHOLD,
  canObservabilityDialPreemptInFlight,
  shouldApplyMarathonObservabilityDialBudget,
  shouldSkipObservabilityDialWhenBusy,
} from './marathonObservabilityDialBudgetCore'

describe('marathonObservabilityDialBudgetCore', () => {
  it('enables budget at marathon conn threshold or quiesce', () => {
    assert.equal(
      shouldApplyMarathonObservabilityDialBudget({
        cursorConnectionCount: MARATHON_OBSERVABILITY_DIAL_CONN_THRESHOLD,
        quiesceActive: false,
      }),
      true,
    )
    assert.equal(
      shouldApplyMarathonObservabilityDialBudget({
        cursorConnectionCount: 0,
        quiesceActive: true,
      }),
      true,
    )
    assert.equal(
      shouldApplyMarathonObservabilityDialBudget({
        cursorConnectionCount: 0,
        quiesceActive: false,
      }),
      false,
    )
  })

  it('skips nudge and connect_stream when busy', () => {
    assert.equal(shouldSkipObservabilityDialWhenBusy('session_nudge'), true)
    assert.equal(shouldSkipObservabilityDialWhenBusy('connect_stream_keepalive'), true)
    assert.equal(shouldSkipObservabilityDialWhenBusy('transport_pair'), false)
    assert.equal(shouldSkipObservabilityDialWhenBusy('user_explicit'), false)
  })

  it('allows user_explicit to preempt in-flight nudge', () => {
    assert.equal(canObservabilityDialPreemptInFlight('user_explicit', 'session_nudge'), true)
    assert.equal(canObservabilityDialPreemptInFlight('session_nudge', 'transport_pair'), false)
    assert.equal(canObservabilityDialPreemptInFlight('transport_pair', 'session_nudge'), true)
  })
})
