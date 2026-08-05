import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HY2_PARENT_ROTATE_AGE_MS,
  resolveOutboundHy2SessionAgeMs,
  resolvePersistedHy2ParentChainAgeMs,
} from './transportLongevityTruthCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { resolveHy2ParentRotationAfterPrunePlan } from './hy2ParentRotationCore'

describe('transportLongevityTruthCore R-34a', () => {
  it('computes outbound HY2 session age from oldest UDP flow', () => {
    const nowMs = 1_000_000
    const ageMs = resolveOutboundHy2SessionAgeMs({
      connections: [
        {
          id: 'udp-1',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'udp' },
        } as ControllerConnectionDetail,
      ],
      trackedById: new Map([
        [
          'udp-1',
          {
            upload: 0,
            download: 0,
            lastBytesChangeAtMs: nowMs,
            firstSeenAtMs: nowMs - HY2_PARENT_ROTATE_AGE_MS - 1_000,
            host: '',
            leaf: 'JP-VPS-HY2',
            network: 'udp',
          },
        ],
      ]),
      activeLeaf: 'JP-VPS-HY2',
      nowMs,
    })
    assert.ok(ageMs >= HY2_PARENT_ROTATE_AGE_MS)
  })

  it('R-40 persist birth survives SSE segment age reset to zero', () => {
    const nowMs = 500_000_000
    const birthMs = nowMs - HY2_PARENT_SIDECAR_DIAL_AGE_MS - 60_000
    const persisted = resolvePersistedHy2ParentChainAgeMs({
      nowMs,
      activeHy2Leaf: 'JP-VPS-HY2',
      previousSnapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs - 5_000,
        cursorConnectionCount: 28,
        httpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 60_000,
        outboundHy2SessionAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 60_000,
        hy2ParentChainBirthMs: birthMs,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      computedHttpParentChainAgeMs: 0,
      computedOutboundHy2SessionAgeMs: 0,
    })
    assert.ok(persisted.httpParentChainAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS)
    assert.equal(persisted.hy2ParentChainBirthMs, birthMs)
  })

  it('R-40b explicit birth reset ignores stale computed UDP age', () => {
    const nowMs = 600_000_000
    const resetBirthMs = nowMs - 5_000
    const persisted = resolvePersistedHy2ParentChainAgeMs({
      nowMs,
      activeHy2Leaf: 'JP-VPS-HY2',
      previousSnapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs - 1_000,
        cursorConnectionCount: 20,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        hy2ParentChainBirthMs: resetBirthMs,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      computedHttpParentChainAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 60_000,
      computedOutboundHy2SessionAgeMs: HY2_PARENT_SIDECAR_DIAL_AGE_MS + 60_000,
    })
    assert.ok(persisted.httpParentChainAgeMs < 60_000)
    assert.equal(persisted.hy2ParentChainBirthMs, resetBirthMs)
  })
})

describe('hy2ParentRotationCore R-34b', () => {
  it('refuses rotation while any inner critical flow exists, even when byte-silent', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 1,
        updatedAtMs: nowMs,
        cursorConnectionCount: 40,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: HY2_PARENT_ROTATE_AGE_MS + 1,
        maxByteStallMs: 0,
        frozenQuicCursorCount: 0,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      connections: [
        {
          id: 'tcp-live',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'tcp', host: 'api2direct.cursor.sh' },
        } as ControllerConnectionDetail,
      ],
      trackedFirstSeenAtMsById: new Map([['tcp-live', nowMs - 60_000]]),
      trackedLastByteChangeAtMsById: new Map([['tcp-live', nowMs - 600_000]]),
      lastRotationAtMs: 0,
      nowMs,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'active_inner_critical_flows')
  })

  it('R-41: emergency stall escalation bypasses 4h session age gate', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 1,
        updatedAtMs: nowMs,
        cursorConnectionCount: 28,
        httpParentChainAgeMs: 0,
        outboundHy2SessionAgeMs: 0,
        maxByteStallMs: 88499,
        frozenQuicCursorCount: 1,
        activeHy2Leaf: 'JP-VPS-HY2',
      },
      connections: [
        {
          id: 'udp-parent',
          chains: ['JP-VPS-HY2'],
          metadata: { network: 'udp' },
        } as ControllerConnectionDetail,
      ],
      trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 600_000]]),
      trackedLastByteChangeAtMsById: new Map([['udp-parent', nowMs - 600_000]]),
      lastRotationAtMs: 0,
      nowMs,
      emergencyStallEscalation: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.reason, 'parent_session_refresh_after_prune')
  })

  it('Phase B: carrier quiesce bypasses active_inner for parent UDP close', () => {
    const nowMs = 2_000_000
    const plan = resolveHy2ParentRotationAfterPrunePlan({
      snapshot: {
        schemaVersion: 2,
        updatedAtMs: nowMs,
        cursorConnectionCount: 21,
        httpParentChainAgeMs: 4 * 60 * 60 * 1000 + 1,
        outboundHy2SessionAgeMs: 4 * 60 * 60 * 1000 + 1,
        maxByteStallMs: 146_002,
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
        ['tcp-live', nowMs - 60_000],
        ['udp-parent', nowMs - 4 * 60 * 60 * 1000],
      ]),
      trackedLastByteChangeAtMsById: new Map([
        ['tcp-live', nowMs - 146_002],
        ['udp-parent', nowMs - 4 * 60 * 60 * 1000],
      ]),
      lastRotationAtMs: 0,
      nowMs,
      carrierQuiesceBypass: true,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.udpConnectionId, 'udp-parent')
  })
})
