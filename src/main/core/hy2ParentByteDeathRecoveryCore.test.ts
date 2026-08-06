import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chainsReferenceActiveLeaf,
  filterHy2LeafConnections,
  formatByteDeathRecoveryLogLine,
  planByteDeathParentMutation,
} from './hy2ParentByteDeathRecoveryCore'

const nowMs = 2_000_000

describe('hy2ParentByteDeathRecoveryCore @1.30.30', () => {
  it('chainsReferenceActiveLeaf matches prod chain hop Cursor专用 → JP-VPS-HY2', () => {
    assert.equal(
      chainsReferenceActiveLeaf(['Cursor专用', 'JP-VPS-HY2'], 'JP-VPS-HY2'),
      true,
    )
    assert.equal(
      chainsReferenceActiveLeaf(['Cursor专用', 'JP-VPS-HY2-custom'], 'JP-VPS-HY2'),
      true,
    )
    assert.equal(chainsReferenceActiveLeaf(['DIRECT'], 'JP-VPS-HY2'), false)
  })

  it('eadc68de: no UDP rows → plan close_leaf_connections on HY2 leaf TCP', () => {
    const connections = [
      {
        id: 'tcp-cursor-1',
        chains: ['Cursor专用', 'JP-VPS-HY2'],
        metadata: { network: 'tcp', host: 'api2.cursor.sh' },
      },
      {
        id: 'tcp-cursor-2',
        chains: ['Cursor专用', 'JP-VPS-HY2'],
        metadata: { network: 'tcp', host: 'api2.cursor.sh' },
      },
    ] as ControllerConnectionDetail[]
    const plan = planByteDeathParentMutation({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
    })
    assert.equal(plan.action, 'close_leaf_connections')
    assert.equal(plan.reason, 'byte_death_close_connections_by_leaf')
    assert.equal(filterHy2LeafConnections(connections, 'JP-VPS-HY2').length, 2)
  })

  it('prefers close_udp_outbound when full scan finds HY2 UDP parent', () => {
    const connections = [
      {
        id: 'udp-parent',
        chains: ['Cursor专用', 'JP-VPS-HY2'],
        metadata: { network: 'udp' },
      },
      {
        id: 'tcp-cursor',
        chains: ['Cursor专用', 'JP-VPS-HY2'],
        metadata: { network: 'tcp', host: 'api2.cursor.sh' },
      },
    ] as ControllerConnectionDetail[]
    const plan = planByteDeathParentMutation({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.udpConnectionId, 'udp-parent')
  })

  it('formatByteDeathRecoveryLogLine includes closed_count for G2 gate', () => {
    const line = formatByteDeathRecoveryLogLine({
      outcome: 'executed',
      action: 'close_leaf_connections',
      reason: 'byte_death_close_connections_by_leaf phase=execute',
      maxByteStallMs: 223_064,
      cursorConn: 73,
      attemptedCount: 94,
      closedCount: 12,
      sampleChains: ['["Cursor专用","JP-VPS-HY2"]'],
    })
    assert.match(line, /\[Hy2ParentByteDeathRecovery\]:/)
    assert.match(line, /closed_count=12/)
    assert.match(line, /attempted_count=94/)
  })

  it('returns none when no HY2 leaf targets and no UDP parent', () => {
    const plan = planByteDeathParentMutation({
      connections: [
        {
          id: 'direct-only',
          chains: ['DIRECT'],
          metadata: { network: 'tcp' },
        } as ControllerConnectionDetail,
      ],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
    })
    assert.equal(plan.action, 'none')
    assert.equal(plan.reason, 'byte_death_no_mutation_targets')
  })
})
