import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BYTE_DEATH_LEAF_CLOSE_MAX_BATCH,
  BYTE_DEATH_LEAF_CLOSE_MIN_STALL_MS,
  chainsReferenceActiveLeaf,
  filterHy2LeafConnections,
  formatByteDeathRecoveryLogLine,
  isByteDeathUdpParentAbsent,
  planByteDeathParentMutation,
  selectByteDeathLeafCloseTargets,
} from './hy2ParentByteDeathRecoveryCore'

const nowMs = 2_000_000

function prodLikeConnections(count: number): ControllerConnectionDetail[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `tcp-${index}`,
    chains: ['Cursor专用', 'JP-VPS-HY2'],
    metadata: { network: 'tcp', host: 'api2.cursor.sh' },
  })) as ControllerConnectionDetail[]
}

describe('hy2ParentByteDeathRecoveryCore @1.30.32', () => {
  it('chainsReferenceActiveLeaf matches prod chain hop Cursor专用 → JP-VPS-HY2', () => {
    assert.equal(
      chainsReferenceActiveLeaf(['Cursor专用', 'JP-VPS-HY2'], 'JP-VPS-HY2'),
      true,
    )
    assert.equal(chainsReferenceActiveLeaf(['DIRECT'], 'JP-VPS-HY2'), false)
  })

  it('C-8.12: udp absent + 94 frozen conns → parent birth reset not leaf close', () => {
    const connections = prodLikeConnections(94)
    const trackedLastByteChangeAtMsById = new Map(
      connections.map((conn) => [conn.id, nowMs - 120_000]),
    )
    const targets = selectByteDeathLeafCloseTargets({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedLastByteChangeAtMsById,
      nowMs,
    })
    assert.equal(targets.length, BYTE_DEATH_LEAF_CLOSE_MAX_BATCH)
    const plan = planByteDeathParentMutation({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      trackedLastByteChangeAtMsById,
      nowMs,
    })
    assert.equal(plan.action, 'reset_parent_chain_birth')
    assert.equal(plan.reason, 'byte_death_udp_absent_parent_birth_reset')
  })

  it('skips healthy leaf conns with stall below 90s threshold', () => {
    const connections = prodLikeConnections(20)
    const trackedLastByteChangeAtMsById = new Map(
      connections.map((conn, index) => [
        conn.id,
        nowMs - (index < 10 ? 30_000 : 120_000),
      ]),
    )
    const targets = selectByteDeathLeafCloseTargets({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedLastByteChangeAtMsById,
      nowMs,
    })
    assert.equal(targets.length, BYTE_DEATH_LEAF_CLOSE_MAX_BATCH)
    for (const target of targets) {
      const stallMs = nowMs - (trackedLastByteChangeAtMsById.get(target.id) ?? nowMs)
      assert.ok(stallMs >= BYTE_DEATH_LEAF_CLOSE_MIN_STALL_MS)
    }
  })

  it('C-8.12: no non-frozen fallback close when all leaves healthy', () => {
    const connections = prodLikeConnections(5)
    const trackedLastByteChangeAtMsById = new Map(
      connections.map((conn) => [conn.id, nowMs - 30_000]),
    )
    const targets = selectByteDeathLeafCloseTargets({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedLastByteChangeAtMsById,
      nowMs,
    })
    assert.equal(targets.length, 0)
  })

  it('prefers close_udp_outbound when full scan finds HY2 UDP parent', () => {
    const connections = [
      {
        id: 'udp-parent',
        chains: ['Cursor专用', 'JP-VPS-HY2'],
        metadata: { network: 'udp' },
      },
      ...prodLikeConnections(3),
    ] as ControllerConnectionDetail[]
    const plan = planByteDeathParentMutation({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      trackedLastByteChangeAtMsById: new Map(),
      nowMs,
    })
    assert.equal(plan.action, 'close_udp_outbound')
    assert.equal(plan.udpConnectionId, 'udp-parent')
  })

  it('close_leaf_connections only when UDP parent identifiable', () => {
    const connections = [
      {
        id: 'udp-parent',
        chains: ['OTHER', 'JP-VPS-HY2'],
        metadata: { network: 'udp' },
      },
      ...prodLikeConnections(12),
    ] as ControllerConnectionDetail[]
    const trackedLastByteChangeAtMsById = new Map(
      connections
        .filter((conn) => conn.id.startsWith('tcp-'))
        .map((conn) => [conn.id, nowMs - 150_000]),
    )
    const plan = planByteDeathParentMutation({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 500_000]]),
      trackedLastByteChangeAtMsById,
      nowMs,
    })
    assert.equal(plan.action, 'close_udp_outbound')
  })

  it('isByteDeathUdpParentAbsent true when diagnostics all zero', () => {
    assert.equal(
      isByteDeathUdpParentAbsent({ source: 'none', diagnostics: { totalConnections: 94, udpOnLeafStrict: 0, udpFullScanCandidates: 0 } }),
      true,
    )
    assert.equal(
      isByteDeathUdpParentAbsent({
        source: 'mihomo_full_scan_hy2_udp',
        connectionId: 'udp-1',
        diagnostics: { totalConnections: 94, udpOnLeafStrict: 0, udpFullScanCandidates: 1 },
      }),
      false,
    )
  })

  it('formatByteDeathRecoveryLogLine includes closed_count for G2 gate', () => {
    const line = formatByteDeathRecoveryLogLine({
      outcome: 'executed',
      action: 'close_leaf_connections',
      reason: 'byte_death_close_frozen_leaf_batch phase=execute',
      closedCount: 8,
      attemptedCount: 8,
    })
    assert.match(line, /\[Hy2ParentByteDeathRecovery\]:/)
    assert.match(line, /closed_count=8/)
  })

  it('C-8.12: untracked leaf conns are never close targets', () => {
    const connections = prodLikeConnections(10)
    const targets = selectByteDeathLeafCloseTargets({
      connections,
      activeLeaf: 'JP-VPS-HY2',
      trackedLastByteChangeAtMsById: new Map(),
      nowMs,
    })
    assert.equal(targets.length, 0)
  })

  it('no HY2 leaf targets → parent birth reset not none', () => {
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
      trackedLastByteChangeAtMsById: new Map(),
      nowMs,
    })
    assert.equal(plan.action, 'reset_parent_chain_birth')
    assert.equal(filterHy2LeafConnections([], 'JP-VPS-HY2').length, 0)
  })
})
