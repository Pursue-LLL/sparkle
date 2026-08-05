import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CARRIER_QUIESCE_BYTE_FROZEN_MS } from './carrierQuiesceRefreshCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { resolveMarathonParentRecoveryStallProof } from './marathonParentRecoveryStallProofCore'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'

const baseObservation = {
  kind: 'single' as const,
  connectionId: 'conn-1',
  host: 'api2.cursor.sh',
  leaf: 'JP-VPS-HY2',
  network: 'tcp',
  connAgeMs: 200_000,
  totalQuicCursorCount: 10,
  cursorConnectionCount: 14,
}

describe('marathonParentRecoveryStallProofCore 1.30.12', () => {
  it('proves recovery when frozen_quic cluster and byte-frozen', () => {
    const decision = resolveMarathonParentRecoveryStallProof({
      marathonActive: true,
      observation: {
        ...baseObservation,
        stallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 1,
        frozenQuicCursorCount: 2,
      },
      httpParentChainAgeMs: 0,
      outboundHy2SessionAgeMs: 0,
    })
    assert.equal(decision.proof, true)
    assert.equal(decision.kind, 'frozen_quic_cluster')
  })

  it('proves recovery on absolute byte stall during marathon', () => {
    const decision = resolveMarathonParentRecoveryStallProof({
      marathonActive: true,
      observation: {
        ...baseObservation,
        stallMs: MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS + 1,
        frozenQuicCursorCount: 0,
      },
    })
    assert.equal(decision.proof, true)
    assert.equal(decision.kind, 'absolute_byte_stall')
  })

  it('blocks short stall without frozen_quic (model thinking)', () => {
    const decision = resolveMarathonParentRecoveryStallProof({
      marathonActive: true,
      observation: {
        ...baseObservation,
        stallMs: MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS + 5_000,
        frozenQuicCursorCount: 0,
      },
      httpParentChainAgeMs: 0,
    })
    assert.equal(decision.proof, false)
  })

  it('proves recovery when parent stale and byte-frozen', () => {
    const decision = resolveMarathonParentRecoveryStallProof({
      marathonActive: true,
      observation: {
        ...baseObservation,
        stallMs: CARRIER_QUIESCE_BYTE_FROZEN_MS + 1,
        frozenQuicCursorCount: 0,
      },
      httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 1,
    })
    assert.equal(decision.proof, true)
    assert.equal(decision.kind, 'parent_stale_byte_frozen')
  })
})
