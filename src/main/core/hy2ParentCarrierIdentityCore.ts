// [INPUT] mihomo connection snapshots · active HY2 leaf
// [OUTPUT] resolveHy2ParentUdpOutboundConnectionId
// [POS] C-8.1 SSOT — multi-strategy HY2 parent UDP identity (fixes high-conn no_udp_outbound).

import {
  findOldestHy2UdpOutboundConnectionId,
} from './hy2ParentRotationCore'
import { resolveMarathonQuIcLeafFromChains } from './mihomoQuicSilentStallCore'

export type Hy2ParentUdpResolutionSource =
  | 'mihomo_udp_network'
  | 'mihomo_udp_chain_hop'
  | 'none'

export interface Hy2ParentUdpResolution {
  connectionId?: string
  source: Hy2ParentUdpResolutionSource
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

/**
 * High cursor_conn marathon: mihomo may omit UDP parent rows or leave them untracked.
 * Prefer explicit UDP network rows; fall back to UDP hop on the active leaf chain.
 */
export function resolveHy2ParentUdpOutboundConnectionId(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  nowMs: number
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

  let oldestId: string | undefined
  let oldestFirstSeenMs = Number.POSITIVE_INFINITY
  for (const connection of input.connections) {
    if (!connectionMatchesActiveLeaf(connection, activeLeaf)) {
      continue
    }
    const network = normalizeNetwork(connection.metadata?.network)
    if (network !== 'udp') {
      continue
    }
    const tracked = input.trackedFirstSeenAtMsById.get(connection.id)
    const firstSeenMs = tracked ?? 0
    if (firstSeenMs < oldestFirstSeenMs) {
      oldestFirstSeenMs = firstSeenMs
      oldestId = connection.id
    }
  }
  if (oldestId) {
    return { connectionId: oldestId, source: 'mihomo_udp_chain_hop' }
  }

  return { source: 'none' }
}
