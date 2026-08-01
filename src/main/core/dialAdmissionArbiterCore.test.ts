import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'

describe('dialAdmissionArbiterCore P10-2', () => {
  it('production bypasses arbiter without in-flight state', () => {
    const state = createInitialDialAdmissionState()
    const decision = resolveDialAdmission(state, {
      dialId: 'd1',
      class: 'production',
      caller: 'cursor',
      incidentGeneration: 'inc-1',
      submittedAtMs: 1,
    })
    assert.equal(decision.admitted, true)
    assert.equal(decision.nextState.inFlightDialId, undefined)
  })

  it('blocks passive observation dial', () => {
    const decision = resolveDialAdmission(createInitialDialAdmissionState(), {
      dialId: 'd2',
      class: 'passive',
      caller: 'observer',
      incidentGeneration: 'inc-1',
      submittedAtMs: 1,
    })
    assert.equal(decision.admitted, false)
    assert.equal(decision.reason, 'passive_no_dial')
  })

  it('enforces single in-flight per incident generation', () => {
    let state = createInitialDialAdmissionState()
    const first = resolveDialAdmission(state, {
      dialId: 'd3',
      class: 'active_recovery',
      caller: 'mtdo',
      incidentGeneration: 'inc-a',
      submittedAtMs: 1,
    })
    assert.equal(first.admitted, true)
    state = first.nextState
    const second = resolveDialAdmission(state, {
      dialId: 'd4',
      class: 'active_recovery',
      caller: 'mtdo',
      incidentGeneration: 'inc-a',
      submittedAtMs: 2,
    })
    assert.equal(second.admitted, false)
    assert.equal(second.reason, 'single_inflight_per_incident')
  })

  it('blocks second active_recovery while global control dial is in-flight', () => {
    let state = createInitialDialAdmissionState()
    const first = resolveDialAdmission(state, {
      dialId: 'd7',
      class: 'active_recovery',
      caller: 'mtdo',
      incidentGeneration: 'inc-a',
      submittedAtMs: 1,
    })
    state = first.nextState
    const second = resolveDialAdmission(state, {
      dialId: 'd8',
      class: 'active_recovery',
      caller: 'hy2TunnelVitality',
      incidentGeneration: 'inc-b',
      submittedAtMs: 2,
    })
    assert.equal(second.admitted, false)
    assert.equal(second.reason, 'global_control_inflight')
  })

  it('closes incident generation after INEFFECTIVE outcome', () => {
    let state = createInitialDialAdmissionState()
    const admitted = resolveDialAdmission(state, {
      dialId: 'd5',
      class: 'active_recovery',
      caller: 'mtdo',
      incidentGeneration: 'inc-z',
      submittedAtMs: 1,
    })
    state = markDialAdmissionOutcome(
      admitted.nextState,
      'd5',
      'inc-z',
      'INEFFECTIVE',
    )
    const retry = resolveDialAdmission(state, {
      dialId: 'd6',
      class: 'active_recovery',
      caller: 'mtdo',
      incidentGeneration: 'inc-z',
      submittedAtMs: 2,
    })
    assert.equal(retry.admitted, false)
    assert.equal(retry.reason, 'incident_generation_closed')
  })
})
