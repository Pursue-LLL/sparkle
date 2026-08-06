import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS } from './marathonSseCarrierPruneCore'
import { resolveHy2ParentRotationAfterPrunePlan } from './hy2ParentRotationCore'

describe('resolveHy2ParentRotationAfterPrunePlan @1.30.17', () => {
  it('1.30.17: marathonGlobalByteDeath bypasses active_inner when carrierQuiesceBypass false', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs,
        cursorConnectionCount: 25,
        httpParentChainAgeMs: 11_282_033,
        outboundHy2SessionAgeMs: 11_282_033,
        maxByteStallMs: 144_500,
        frozenQuicCursorCount: 2,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      connections: [
        {
          id: 'tcp-live',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'tcp', host: 'api2direct.cursor.sh' },
        } as ControllerConnectionDetail,
        {
          id: 'udp-parent',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'udp' },
        } as ControllerConnectionDetail,
      ],
      trackedFirstSeenAtMsById: new Map([
        ['tcp-live', nowMs - 93_510],
        ['udp-parent', nowMs - 11_282_033],
      ]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS],
        ['udp-parent', nowMs - 11_282_033],
      ]),
      lastRotationAtMs: nowMs - 30_000,
      nowMs,
      emergencyStallEscalation: true,
      carrierQuiesceBypass: false,
      marathonGlobalByteDeath: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.reason, 'parent_session_refresh_after_prune')
    assert.equal(plan.udpConnectionId, 'udp-parent')
  })

  it('blocks active_inner when neither bypass nor byte-death', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs,
        cursorConnectionCount: 25,
        httpParentChainAgeMs: 11_282_033,
        outboundHy2SessionAgeMs: 11_282_033,
        maxByteStallMs: 60_000,
        frozenQuicCursorCount: 0,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      connections: [
        {
          id: 'tcp-live',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'tcp', host: 'api2.cursor.sh' },
        } as ControllerConnectionDetail,
        {
          id: 'udp-parent',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'udp' },
        } as ControllerConnectionDetail,
      ],
      trackedFirstSeenAtMsById: new Map([
        ['tcp-live', nowMs - 60_000],
        ['udp-parent', nowMs - 11_282_033],
      ]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - 60_000],
        ['udp-parent', nowMs - 11_282_033],
      ]),
      lastRotationAtMs: 0,
      nowMs,
      emergencyStallEscalation: true,
      carrierQuiesceBypass: false,
      marathonGlobalByteDeath: false,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'active_inner_critical_flows')
  })

  it('1.30.28: high-conn untracked udp resolves via chain-hop for SEL R2', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs,
        cursorConnectionCount: 158,
        httpParentChainAgeMs: 5493,
        outboundHy2SessionAgeMs: 5493,
        maxByteStallMs: 286_504,
        frozenQuicCursorCount: 10,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      connections: [
        {
          id: 'tcp-live',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'tcp', host: 'api2.cursor.sh' },
        } as ControllerConnectionDetail,
        {
          id: 'udp-untracked-0806',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'udp' },
        } as ControllerConnectionDetail,
      ],
      trackedFirstSeenAtMsById: new Map([['tcp-live', nowMs - 300_000]]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - MARATHON_SSE_CARRIER_ABSOLUTE_STALL_MS],
        ['udp-untracked-0806', nowMs - 5493],
      ]),
      lastRotationAtMs: nowMs - 30_000,
      nowMs,
      emergencyStallEscalation: true,
      marathonGlobalByteDeath: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.match(plan.reason, /^parent_session_refresh_after_prune/)
    assert.equal(plan.udpConnectionId, 'udp-untracked-0806')
  })
})
