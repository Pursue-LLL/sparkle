import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'

const nowMs = 2_000_000

describe('resolveHy2ParentUdpOutboundConnectionId @1.30.29', () => {
  it('returns strict udp network match when tracked', () => {
    const udp = {
      id: 'udp-parent',
      chains: ['JP-VPS-HY2'],
      metadata: { network: 'udp' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [udp],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map([['udp-parent', nowMs - 120_000]]),
      nowMs,
    })
    assert.equal(resolution.connectionId, 'udp-parent')
    assert.equal(resolution.source, 'mihomo_udp_network')
  })

  it('0806: high-conn untracked udp resolves via strict path with firstSeen fallback', () => {
    const udp = {
      id: 'udp-untracked',
      chains: ['JP-VPS-HY2'],
      metadata: { network: 'udp' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [udp],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
    })
    assert.equal(resolution.connectionId, 'udp-untracked')
    assert.equal(resolution.source, 'mihomo_udp_network')
  })

  it('returns none when no udp on active leaf without full scan', () => {
    const tcp = {
      id: 'tcp-only',
      chains: ['JP-VPS-HY2'],
      metadata: { network: 'tcp', host: 'api2.cursor.sh' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [tcp],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
    })
    assert.equal(resolution.connectionId, undefined)
    assert.equal(resolution.source, 'none')
    assert.equal(resolution.diagnostics, undefined)
  })

  it('C-8.9: byteDeathFullScan resolves udp via chain_contains when leaf resolver misses', () => {
    const udp = {
      id: 'udp-chain-contains',
      chains: ['Cursor专用', 'JP-VPS-HY2-custom'],
      metadata: { network: 'udp' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [udp],
      activeLeaf: 'JP-VPS-HY2-custom',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
      byteDeathFullScan: true,
    })
    assert.equal(resolution.connectionId, 'udp-chain-contains')
    assert.equal(resolution.source, 'mihomo_udp_chain_contains')
  })

  it('C-8.9: byteDeathFullScan resolves orphan HY2 udp via full_scan', () => {
    const udp = {
      id: 'udp-orphan-hy2',
      chains: ['DIRECT', 'OTHER-HY2'],
      metadata: { network: 'udp' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [udp],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
      byteDeathFullScan: true,
    })
    assert.equal(resolution.connectionId, 'udp-orphan-hy2')
    assert.equal(resolution.source, 'mihomo_full_scan_hy2_udp')
  })

  it('C-8.9: byteDeathFullScan none includes diagnostics when mihomo omits udp rows', () => {
    const tcp = {
      id: 'tcp-only',
      chains: ['JP-VPS-HY2'],
      metadata: { network: 'tcp', host: 'api2.cursor.sh' },
    } as ControllerConnectionDetail
    const resolution = resolveHy2ParentUdpOutboundConnectionId({
      connections: [tcp],
      activeLeaf: 'JP-VPS-HY2',
      trackedFirstSeenAtMsById: new Map(),
      nowMs,
      byteDeathFullScan: true,
    })
    assert.equal(resolution.connectionId, undefined)
    assert.equal(resolution.source, 'none')
    assert.deepEqual(resolution.diagnostics, {
      totalConnections: 1,
      udpOnLeafStrict: 0,
      udpFullScanCandidates: 0,
    })
  })
})
