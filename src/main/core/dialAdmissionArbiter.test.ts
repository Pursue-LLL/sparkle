import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  admitDialIntent,
  buildRecoveryIncidentGeneration,
  completeDialIntent,
  getDialAdmissionStateForTests,
  resetDialAdmissionArbiterForTests,
} from './dialAdmissionArbiter'

describe('dialAdmissionArbiter runtime P10-2', () => {
  it('buildRecoveryIncidentGeneration anchors on first stale RID', () => {
    const gen = buildRecoveryIncidentGeneration(
      'token_gap',
      ['rid-a', 'rid-b'],
      1_800_000,
    )
    assert.equal(gen, 'token_gap:rid-a:30')
  })

  it('blocks second active_recovery dial for closed incident generation', () => {
    resetDialAdmissionArbiterForTests()
    const incidentGeneration = 'connect_partition:rid-x:99'
    const first = admitDialIntent({
      dialId: 'd1',
      class: 'active_recovery',
      caller: 'marathonRescueDialExecutor',
      incidentGeneration,
      submittedAtMs: 1,
    })
    assert.equal(first.admitted, true)
    completeDialIntent('d1', incidentGeneration, 'INEFFECTIVE')
    const second = admitDialIntent({
      dialId: 'd2',
      class: 'active_recovery',
      caller: 'marathonRescueDialExecutor',
      incidentGeneration,
      submittedAtMs: 2,
    })
    assert.equal(second.admitted, false)
    assert.equal(second.reason, 'incident_generation_closed')
    assert.equal(getDialAdmissionStateForTests().inFlightDialId, undefined)
  })
})
