// [INPUT] TransportLongevityTruthSnapshot · mihomo connections after prune
// [OUTPUT] resolveHy2ParentRotationAfterPrunePlan
// [POS] R-34b SSOT — refresh aged HY2 UDP session only when no healthy inner critical flows remain.

import {
  HY2_PARENT_ROTATE_AGE_MS,
  type TransportLongevityTruthSnapshot,
} from './transportLongevityTruthCore'
import {
  isCriticalCursorHost,
} from './cursorCriticalTransportCore'
import {
  resolveConnectionHost,
  resolveMarathonQuIcLeafFromChains,
} from './mihomoQuicSilentStallCore'

export const HY2_PARENT_ROTATION_COOLDOWN_MS = 300_000

export type Hy2ParentRotationAction = 'none' | 'close_udp_outbound'

export interface Hy2ParentRotationPlan {
  action: Hy2ParentRotationAction
  reason: string
  udpConnectionId?: string
}

export function countHealthyInnerCriticalFlows(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  nowMs: number
  byteActiveWithinMs: number
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
}): number {
  let count = 0
  for (const connection of input.connections) {
    const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? [])
    if (leaf !== input.activeLeaf) {
      continue
    }
    const network = String(connection.metadata?.network ?? '')
    if (network === 'udp') {
      continue
    }
    const host = resolveConnectionHost(connection)
    if (!isCriticalCursorHost(host)) {
      continue
    }
    const lastChangeAtMs = input.trackedLastByteChangeAtMsById.get(connection.id) ?? input.nowMs
    if (input.nowMs - lastChangeAtMs <= input.byteActiveWithinMs) {
      count += 1
    }
  }
  return count
}

export function findOldestHy2UdpOutboundConnectionId(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
}): string | undefined {
  let oldestId: string | undefined
  let oldestFirstSeenMs = Number.POSITIVE_INFINITY
  for (const connection of input.connections) {
    const leaf = resolveMarathonQuIcLeafFromChains(connection.chains ?? [])
    if (leaf !== input.activeLeaf) {
      continue
    }
    const network = String(connection.metadata?.network ?? '')
    if (network !== 'udp') {
      continue
    }
    const firstSeenMs = input.trackedFirstSeenAtMsById.get(connection.id) ?? Number.POSITIVE_INFINITY
    if (firstSeenMs < oldestFirstSeenMs) {
      oldestFirstSeenMs = firstSeenMs
      oldestId = connection.id
    }
  }
  return oldestId
}

export function resolveHy2ParentRotationAfterPrunePlan(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  lastRotationAtMs: number
  nowMs: number
}): Hy2ParentRotationPlan {
  if (input.snapshot.outboundHy2SessionAgeMs < HY2_PARENT_ROTATE_AGE_MS) {
    return { action: 'none', reason: 'session_age_below_threshold' }
  }
  if (input.nowMs - input.lastRotationAtMs < HY2_PARENT_ROTATION_COOLDOWN_MS) {
    return { action: 'none', reason: 'rotation_cooldown' }
  }
  const healthyInner = countHealthyInnerCriticalFlows({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
    nowMs: input.nowMs,
    byteActiveWithinMs: 30_000,
    trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
  })
  if (healthyInner > 0) {
    return { action: 'none', reason: 'healthy_inner_critical_flows' }
  }
  const udpConnectionId = findOldestHy2UdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
  })
  if (!udpConnectionId) {
    return { action: 'none', reason: 'no_udp_outbound' }
  }
  return {
    action: 'close_udp_outbound',
    reason: 'parent_session_refresh_after_prune',
    udpConnectionId,
  }
}
