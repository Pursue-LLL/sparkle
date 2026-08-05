import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'
import { resolveProactiveUdpClosePlan } from './hy2ParentSidecar'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'

function snapshot(
  overrides: Partial<TransportLongevityTruthSnapshot> = {},
): TransportLongevityTruthSnapshot {
  return {
    schemaVersion: 2,
    updatedAtMs: 2_000_000,
    cursorConnectionCount: 14,
    httpParentChainAgeMs: 0,
    outboundHy2SessionAgeMs: 0,
    maxByteStallMs: MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS,
    frozenQuicCursorCount: 2,
    activeHy2Leaf: 'JP-VPS-HY2',
    ...overrides,
  }
}

const tcpLive = {
  id: 'tcp-live',
  chains: ['JP-VPS-HY2'],
  metadata: { network: 'tcp', host: 'api2.cursor.sh' },
} as ControllerConnectionDetail

const udpParent = {
  id: 'udp-parent',
  chains: ['JP-VPS-HY2'],
  metadata: { network: 'udp' },
} as ControllerConnectionDetail

describe('resolveProactiveUdpClosePlan @1.30.16', () => {
  it('1.30.16: marathon global byte-death bypasses young parent age gate', () => {
    const nowMs = 2_000_000
    const plan = resolveProactiveUdpClosePlan({
      snapshot: snapshot(),
      connections: [tcpLive, udpParent],
      trackedFirstSeenAtMsById: new Map([
        ['tcp-live', nowMs - 60_000],
        ['udp-parent', nowMs - 120_000],
      ]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS],
        ['udp-parent', nowMs - 120_000],
      ]),
      nowMs,
      lastRotateActionAtMs: nowMs - 60_000,
      recoveryIneffective: true,
      marathonActive: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.reason, 'carrier_quiesce_parent_udp_refresh')
    assert.equal(plan.udpConnectionId, 'udp-parent')
  })

  it('blocks young parent rotate when marathon inactive and no byte-death', () => {
    const nowMs = 2_000_000
    const plan = resolveProactiveUdpClosePlan({
      snapshot: snapshot({
        maxByteStallMs: 60_000,
        frozenQuicCursorCount: 0,
      }),
      connections: [tcpLive, udpParent],
      trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 120_000]]),
      trackedLastByteChangeAtMsById: new Map([['udp-parent', nowMs - 120_000]]),
      nowMs,
      lastRotateActionAtMs: 0,
      recoveryIneffective: true,
      marathonActive: false,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'session_and_http_chain_below_proactive_rotate')
  })

  it('1.30.16: marathon byte-death bypasses proactive rotate cooldown', () => {
    const nowMs = 2_000_000
    const plan = resolveProactiveUdpClosePlan({
      snapshot: snapshot(),
      connections: [tcpLive, udpParent],
      trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 120_000]]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS],
        ['udp-parent', nowMs - 120_000],
      ]),
      nowMs,
      lastRotateActionAtMs: nowMs - 30_000,
      recoveryIneffective: true,
      marathonActive: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.reason, 'carrier_quiesce_parent_udp_refresh')
  })
})
