import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HY2_PARENT_ROTATE_AGE_MS,
  resolveOutboundHy2SessionAgeMs,
} from './transportLongevityTruthCore'
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
})

describe('hy2ParentRotationCore R-34b', () => {
  it('refuses rotation while healthy inner critical flows exist', () => {
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
      trackedLastByteChangeAtMsById: new Map([['tcp-live', nowMs - 1_000]]),
      lastRotationAtMs: 0,
      nowMs,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'healthy_inner_critical_flows')
  })
})
