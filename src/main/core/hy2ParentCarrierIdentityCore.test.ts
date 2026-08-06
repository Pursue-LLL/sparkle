import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'

const nowMs = 2_000_000

describe('resolveHy2ParentUdpOutboundConnectionId @1.30.28', () => {
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

  it('returns none when no udp on active leaf', () => {
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
  })
})
