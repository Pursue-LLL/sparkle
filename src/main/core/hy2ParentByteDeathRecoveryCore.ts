// [INPUT] mihomo connection snapshots · carrier identity SSOT · active HY2 leaf
// [OUTPUT] planByteDeathParentMutation · filterHy2LeafConnections · formatByteDeathRecoveryLogLine
// [POS] C-8.10 SSOT — single byte-death parent mutation planner (replaces scattered sidecar fallback).

import {
  resolveHy2ParentUdpOutboundConnectionId,
  type Hy2ParentUdpResolution,
} from './hy2ParentCarrierIdentityCore'

export type ByteDeathParentMutationAction =
  | 'none'
  | 'close_udp_outbound'
  | 'close_leaf_connections'

export interface ByteDeathParentMutationPlan {
  action: ByteDeathParentMutationAction
  reason: string
  udpConnectionId?: string
  udpResolutionSource?: Hy2ParentUdpResolution['source']
}

export interface Hy2LeafConnectionCloseReport {
  activeLeaf: string
  attemptedCount: number
  closedCount: number
  failedCount: number
  sampleChains: string[]
  err?: string
}

export function chainsReferenceActiveLeaf(
  chains: readonly string[],
  activeLeaf: string,
): boolean {
  const leaf = activeLeaf.trim()
  if (!leaf) {
    return false
  }
  return chains.some((chain) => {
    const trimmed = chain.trim()
    return trimmed === leaf || trimmed.includes(leaf) || leaf.includes(trimmed)
  })
}

export function filterHy2LeafConnections(
  connections: readonly ControllerConnectionDetail[],
  activeLeaf: string,
): ControllerConnectionDetail[] {
  const leaf = activeLeaf.trim()
  if (!leaf) {
    return []
  }
  return connections.filter((connection) =>
    chainsReferenceActiveLeaf(connection.chains ?? [], leaf),
  )
}

export function planByteDeathParentMutation(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  nowMs: number
}): ByteDeathParentMutationPlan {
  const resolution = resolveHy2ParentUdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf: input.activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    nowMs: input.nowMs,
    byteDeathFullScan: true,
  })
  if (resolution.connectionId) {
    return {
      action: 'close_udp_outbound',
      reason: `byte_death_full_scan_${resolution.source}`,
      udpConnectionId: resolution.connectionId,
      udpResolutionSource: resolution.source,
    }
  }
  const leafTargets = filterHy2LeafConnections(input.connections, input.activeLeaf)
  if (leafTargets.length > 0) {
    return {
      action: 'close_leaf_connections',
      reason: 'byte_death_close_connections_by_leaf',
    }
  }
  return {
    action: 'none',
    reason: 'byte_death_no_mutation_targets',
  }
}

export function formatByteDeathRecoveryLogLine(input: {
  outcome: 'planned' | 'executed' | 'failed' | 'skipped'
  action: ByteDeathParentMutationAction | 'sidecar_dial'
  reason: string
  maxByteStallMs?: number
  cursorConn?: number
  udpConnectionId?: string
  closedCount?: number
  attemptedCount?: number
  totalConn?: number
  udpLeafStrict?: number
  udpFullScan?: number
  sampleChains?: readonly string[]
  err?: string
}): string {
  const parts = [
    `[Hy2ParentByteDeathRecovery]: outcome=${input.outcome}`,
    `action=${input.action}`,
    `reason=${input.reason}`,
  ]
  if (input.maxByteStallMs != null) {
    parts.push(`max_byte_stall_ms=${input.maxByteStallMs}`)
  }
  if (input.cursorConn != null) {
    parts.push(`cursor_conn=${input.cursorConn}`)
  }
  if (input.totalConn != null) {
    parts.push(`total_conn=${input.totalConn}`)
  }
  if (input.udpLeafStrict != null) {
    parts.push(`udp_leaf_strict=${input.udpLeafStrict}`)
  }
  if (input.udpFullScan != null) {
    parts.push(`udp_full_scan=${input.udpFullScan}`)
  }
  if (input.udpConnectionId) {
    parts.push(`udp_connection_id=${input.udpConnectionId}`)
  }
  if (input.attemptedCount != null) {
    parts.push(`attempted_count=${input.attemptedCount}`)
  }
  if (input.closedCount != null) {
    parts.push(`closed_count=${input.closedCount}`)
  }
  if (input.sampleChains && input.sampleChains.length > 0) {
    parts.push(`sample_chains=${JSON.stringify(input.sampleChains)}`)
  }
  if (input.err) {
    parts.push(`err=${input.err}`)
  }
  return `${parts.join(' ')}\n`
}

export function buildLeafCloseReport(input: {
  activeLeaf: string
  connections: readonly ControllerConnectionDetail[]
  closedIds: readonly string[]
  failedIds: readonly string[]
  err?: string
}): Hy2LeafConnectionCloseReport {
  const targets = filterHy2LeafConnections(input.connections, input.activeLeaf)
  const sampleChains = targets.slice(0, 3).map((conn) =>
    JSON.stringify(conn.chains ?? []),
  )
  return {
    activeLeaf: input.activeLeaf,
    attemptedCount: targets.length,
    closedCount: input.closedIds.length,
    failedCount: input.failedIds.length,
    sampleChains,
    err: input.err,
  }
}
