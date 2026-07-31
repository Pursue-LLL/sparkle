import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeRegistryMaxGapSinceActivityMs,
  isMarathonSseCarrierStaleCandidate,
  MARATHON_SSE_CARRIER_REGISTRY_GAP_MS,
} from './marathonSseCarrierPruneCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'

describe('marathonSseCarrierPruneCore R-35b', () => {
  const observation = {
    kind: 'single' as const,
    connectionId: 'conn-carrier-1',
    host: 'api2direct.cursor.sh',
    leaf: 'JP-VPS-HY2',
    network: 'tcp',
    stallMs: 47_000,
    connAgeMs: 200_000,
    frozenQuicCursorCount: 1,
    totalQuicCursorCount: 8,
    cursorConnectionCount: 33,
  }

  it('accepts registry gap proof at 47s stall', () => {
    const ok = isMarathonSseCarrierStaleCandidate({
      observation,
      marathonActive: true,
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      registryMaxGapSinceActivityMs: MARATHON_SSE_CARRIER_REGISTRY_GAP_MS + 1,
    })
    assert.equal(ok, true)
  })

  it('accepts token gap proof', () => {
    const ok = isMarathonSseCarrierStaleCandidate({
      observation,
      marathonActive: true,
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIdCount: 1,
      registryMaxGapSinceActivityMs: 0,
    })
    assert.equal(ok, true)
  })

  it('rejects without stale proof (zero mis-kill)', () => {
    const ok = isMarathonSseCarrierStaleCandidate({
      observation,
      marathonActive: true,
      tokenGapMaxMs: 0,
      staleRequestIdCount: 0,
      registryMaxGapSinceActivityMs: 0,
    })
    assert.equal(ok, false)
  })

  it('computeRegistryMaxGapSinceActivityMs picks max gap', () => {
    const nowMs = 1_000_000
    const gap = computeRegistryMaxGapSinceActivityMs(
      {
        records: new Map([
          ['a', { requestId: 'a', originalRequestId: 'a', firstActivityMs: 900_000, lastActivityMs: 980_000, openToolCalls: 0 }],
          ['b', { requestId: 'b', originalRequestId: 'b', firstActivityMs: 900_000, lastActivityMs: 960_000, openToolCalls: 1 }],
        ]),
      },
      nowMs,
    )
    assert.equal(gap, 40_000)
  })
})
