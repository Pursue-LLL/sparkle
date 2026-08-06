// [INPUT] mihomo connection snapshots · active HY2 leaf
// [OUTPUT] resolveHy2ParentUdpOutboundConnectionId
// [POS] C-8.1/C-8.9 SSOT — multi-strategy HY2 parent UDP identity (fixes no_udp_outbound).

import {
  findOldestHy2UdpOutboundConnectionId,
} from './hy2ParentRotationCore'
import { isHy2CursorNode } from './cursorHy2MarathonKeepaliveCore'
import { resolveMarathonQuIcLeafFromChains } from './mihomoQuicSilentStallCore'

export type Hy2ParentUdpResolutionSource =
  | 'mihomo_udp_network'
  | 'mihomo_udp_chain_hop'
  | 'mihomo_udp_chain_contains'
  | 'mihomo_full_scan_hy2_udp'
  | 'none'

export interface Hy2ParentUdpResolution {
  connectionId?: string
  source: Hy2ParentUdpResolutionSource
  /** Diagnostic counts when source=none (byte-death triage). */
  diagnostics?: {
    totalConnections: number
    udpOnLeafStrict: number
    udpFullScanCandidates: number
  }
}

function normalizeNetwork(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function connectionMatchesActiveLeaf(
  connection: ControllerConnectionDetail,
  activeLeaf: string,
): boolean {
  return resolveMarathonQuIcLeafFromChains(connection.chains ?? []) === activeLeaf
}

function chainsReferenceActiveLeaf(
  chains: readonly string[],
  activeLeaf: string,
): boolean {
  const leaf = activeLeaf.trim()
  if (!leaf) {
    return false
  }
  return chains.some((chain) => {
    const trimmed = chain.trim()
    return trimmed === leaf || trimmed.includes(leaf)
  })
}

function isUdpConnection(connection: ControllerConnectionDetail): boolean {
  return normalizeNetwork(connection.metadata?.network) === 'udp'
}

function resolveFirstSeenMs(
  connectionId: string,
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>,
): number {
  return trackedFirstSeenAtMsById.get(connectionId) ?? 0
}

function pickOldestUdpCandidate(input: {
  connections: readonly ControllerConnectionDetail[]
  predicate: (connection: ControllerConnectionDetail) => boolean
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
}): string | undefined {
  let oldestId: string | undefined
  let oldestFirstSeenMs = Number.POSITIVE_INFINITY
  for (const connection of input.connections) {
    if (!isUdpConnection(connection) || !input.predicate(connection)) {
      continue
    }
    const firstSeenMs = resolveFirstSeenMs(connection.id, input.trackedFirstSeenAtMsById)
    if (firstSeenMs < oldestFirstSeenMs) {
      oldestFirstSeenMs = firstSeenMs
      oldestId = connection.id
    }
  }
  return oldestId
}

function countUdpCandidates(input: {
  connections: readonly ControllerConnectionDetail[]
  predicate: (connection: ControllerConnectionDetail) => boolean
}): number {
  let count = 0
  for (const connection of input.connections) {
    if (isUdpConnection(connection) && input.predicate(connection)) {
      count += 1
    }
  }
  return count
}

function fullScanHy2UdpPredicate(
  connection: ControllerConnectionDetail,
  activeLeaf: string,
): boolean {
  const chains = connection.chains ?? []
  if (chainsReferenceActiveLeaf(chains, activeLeaf)) {
    return true
  }
  if (connectionMatchesActiveLeaf(connection, activeLeaf)) {
    return true
  }
  if (!isHy2CursorNode(activeLeaf)) {
    return false
  }
  return chains.some((chain) => isHy2CursorNode(chain.trim()))
}

/**
 * High cursor_conn marathon: mihomo may omit UDP parent rows or leave them untracked.
 * Prefer explicit UDP network rows; fall back to chain-hop / chain-contains / full HY2 scan.
 */
export function resolveHy2ParentUdpOutboundConnectionId(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  nowMs: number
  /** C-8.9: enable aggressive full-scan strategies during byte-death only. */
  byteDeathFullScan?: boolean
}): Hy2ParentUdpResolution {
  const activeLeaf = input.activeLeaf.trim()
  if (!activeLeaf) {
    return { source: 'none' }
  }

  const strictUdp = findOldestHy2UdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
  })
  if (strictUdp) {
    return { connectionId: strictUdp, source: 'mihomo_udp_network' }
  }

  const chainHopId = pickOldestUdpCandidate({
    connections: input.connections,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    predicate: (connection) => connectionMatchesActiveLeaf(connection, activeLeaf),
  })
  if (chainHopId) {
    return { connectionId: chainHopId, source: 'mihomo_udp_chain_hop' }
  }

  if (input.byteDeathFullScan !== true) {
    return { source: 'none' }
  }

  const chainContainsId = pickOldestUdpCandidate({
    connections: input.connections,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    predicate: (connection) =>
      chainsReferenceActiveLeaf(connection.chains ?? [], activeLeaf),
  })
  if (chainContainsId) {
    return { connectionId: chainContainsId, source: 'mihomo_udp_chain_contains' }
  }

  const fullScanId = pickOldestUdpCandidate({
    connections: input.connections,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    predicate: (connection) => fullScanHy2UdpPredicate(connection, activeLeaf),
  })
  if (fullScanId) {
    return { connectionId: fullScanId, source: 'mihomo_full_scan_hy2_udp' }
  }

  return {
    source: 'none',
    diagnostics: {
      totalConnections: input.connections.length,
      udpOnLeafStrict: countUdpCandidates({
        connections: input.connections,
        predicate: (connection) => connectionMatchesActiveLeaf(connection, activeLeaf),
      }),
      udpFullScanCandidates: countUdpCandidates({
        connections: input.connections,
        predicate: (connection) => fullScanHy2UdpPredicate(connection, activeLeaf),
      }),
    },
  }
}
