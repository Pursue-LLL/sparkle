import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyDataPlaneMutationTier,
  evaluateMarathonDataPlaneMutation,
} from './dataPlaneMutationTierCore'
import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'

describe('dataPlaneMutationTierCore', () => {
  it('classifies mutation kinds into tiers', () => {
    assert.equal(classifyDataPlaneMutationTier('close_single_connection'), 0)
    assert.equal(classifyDataPlaneMutationTier('provider_hot_reload'), 0)
    assert.equal(classifyDataPlaneMutationTier('sidecar_udp_refresh'), 1)
    assert.equal(classifyDataPlaneMutationTier('core_cold_restart'), 2)
  })

  it('allows tier0 provider hot-reload during marathon', () => {
    const decision = evaluateMarathonDataPlaneMutation({
      kind: 'provider_hot_reload',
      marathonActive: true,
      cursorConnectionCount: 49,
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.tier, 0)
    assert.equal(decision.reason, 'allowed_tier0')
  })

  it('blocks tier2 cold restart when cursor_conn active during marathon', () => {
    const decision = evaluateMarathonDataPlaneMutation({
      kind: 'core_cold_restart',
      marathonActive: true,
      cursorConnectionCount: 49,
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, 'defer_marathon_tier2_blocked')
  })

  it('Sep2 replay: tier0 parent proof at 84s stall with frozen_quic_cluster', () => {
    const decision = evaluateMarathonDataPlaneMutation({
      kind: 'close_single_connection',
      marathonActive: true,
      cursorConnectionCount: 49,
      parentRecoveryProof: true,
      parentRecoveryKind: 'frozen_quic_cluster',
      stallMs: 84_003,
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.tier, 0)
  })

  it('tier1 sidecar allowed when parent chain stale + byte frozen', () => {
    const decision = evaluateMarathonDataPlaneMutation({
      kind: 'sidecar_udp_refresh',
      marathonActive: true,
      cursorConnectionCount: 49,
      stallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 1,
      httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    })
    assert.equal(decision.allowed, true)
    assert.equal(decision.tier, 1)
  })
})
