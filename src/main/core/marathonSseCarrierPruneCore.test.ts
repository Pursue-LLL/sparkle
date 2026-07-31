import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  computeRegistryMaxGapSinceActivityMs,
  MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS,
  MARATHON_SSE_CARRIER_REGISTRY_GAP_MS,
  resolveMarathonSseCarrierPruneContext,
} from './marathonSseCarrierPruneCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'

describe('marathonSseCarrierPruneCore R-35b′', () => {
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

  it('maps carrier_rid from token gap stale list', () => {
    const ctx = resolveMarathonSseCarrierPruneContext({
      observation,
      marathonActive: true,
      tokenGapMaxMs: CURSOR_HY2_TOKEN_GAP_FORCE_MS + 1,
      staleRequestIds: ['rid-stale-1'],
      registry: { records: new Map() },
      nowMs: 1_000_000,
    })
    assert.equal(ctx.eligible, true)
    assert.equal(ctx.carrierRid, 'rid-stale-1')
    assert.equal(ctx.staleProofKind, 'token_gap')
  })

  it('maps carrier_rid from registry gap proof', () => {
    const nowMs = 1_000_000
    const ctx = resolveMarathonSseCarrierPruneContext({
      observation,
      marathonActive: true,
      tokenGapMaxMs: 0,
      staleRequestIds: [],
      registry: {
        records: new Map([
          [
            'req-a',
            {
              requestId: 'req-a',
              originalRequestId: 'rid-registry-1',
              firstActivityMs: 900_000,
              lastActivityMs: nowMs - MARATHON_SSE_CARRIER_REGISTRY_GAP_MS - 1,
              openToolCalls: 0,
            },
          ],
        ]),
      },
      nowMs,
    })
    assert.equal(ctx.eligible, true)
    assert.equal(ctx.carrierRid, 'rid-registry-1')
    assert.equal(ctx.staleProofKind, 'registry_gap')
  })

  it('uses absolute byte stall proof at 90s without registry gap', () => {
    const ctx = resolveMarathonSseCarrierPruneContext({
      observation: { ...observation, stallMs: MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS },
      marathonActive: true,
      tokenGapMaxMs: 0,
      staleRequestIds: [],
      registry: {
        records: new Map([
          [
            'req-a',
            {
              requestId: 'req-a',
              originalRequestId: 'rid-abs-1',
              firstActivityMs: 900_000,
              lastActivityMs: 999_000,
              openToolCalls: 1,
            },
          ],
        ]),
      },
      nowMs: 1_000_000,
    })
    assert.equal(ctx.eligible, true)
    assert.equal(ctx.staleProofKind, 'absolute_byte_stall')
  })

  it('rejects 47s stall without any stale proof (zero mis-kill)', () => {
    const ctx = resolveMarathonSseCarrierPruneContext({
      observation,
      marathonActive: true,
      tokenGapMaxMs: 0,
      staleRequestIds: [],
      registry: {
        records: new Map([
          [
            'req-a',
            {
              requestId: 'req-a',
              originalRequestId: 'rid-live',
              firstActivityMs: 990_000,
              lastActivityMs: 999_000,
              openToolCalls: 1,
            },
          ],
        ]),
      },
      nowMs: 1_000_000,
    })
    assert.equal(ctx.eligible, false)
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
