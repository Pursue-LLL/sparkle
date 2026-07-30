import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  resolveMarathonTransportDialPlan,
} from './marathonTransportDialOrchestratorCore'

describe('marathonTransportDialOrchestrator G10/G12 static', () => {
  it('connect_partition and latency_delta_rescue use connect_rescue_bundle (G12)', () => {
    assert.equal(resolveMarathonTransportDialPlan('connect_partition'), 'connect_rescue_bundle')
    assert.equal(resolveMarathonTransportDialPlan('latency_delta_rescue'), 'connect_rescue_bundle')
  })

  it('cursorHy2MarathonKeepalive has no mtdo re-entrancy guard (G10)', () => {
    const src = readFileSync(
      new URL('./cursorHy2MarathonKeepalive.ts', import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(src, /skipped_mtdo_in_flight/)
    assert.doesNotMatch(src, /isMarathonTransportDialInFlight/)
  })

  it('marathonTransportDialOrchestrator wires P27 hy2 tunnel vitality (G27)', () => {
    const src = readFileSync(
      new URL('./marathonTransportDialOrchestrator.ts', import.meta.url),
      'utf8',
    )
    assert.match(src, /runHy2TunnelVitalityIfDue/)
    assert.match(src, /hy2TunnelVitality/)
  })

  it('marathonTransportDialOrchestrator wires R-24 contention breach SSOT', () => {
    const src = readFileSync(
      new URL('./marathonTransportDialOrchestrator.ts', import.meta.url),
      'utf8',
    )
    assert.match(src, /buildMarathonContentionBreachKinds/)
    assert.match(src, /getMarathonFrozenQuicCursorCount/)
    assert.match(src, /lastMtdoDialAtMs = nowMs/)
    assert.match(src, /executed: false/)
  })
})

// G10 gate #9 full MTDO cycle requires Electron runtime (orchestrator imports mihomo/networkStability).
// Covered by: executeMarathonRescueDial behavioral test + executeDialPlan → executeMarathonRescueDial (no mtdo guard in code).
