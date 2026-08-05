// [INPUT] TransportLongevityTruthSnapshot · mihomo connections after prune
// [OUTPUT] resolveHy2ParentRotationAfterPrunePlan
// [POS] R-34b SSOT — refresh aged HY2 UDP session only when no active inner critical flows remain.

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

export function countActiveInnerCriticalFlows(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
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
    count += 1
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
  /** R-41: bypass 4h age gate when byte-frozen + vitality ineffective. */
  emergencyStallEscalation?: boolean
  /** Phase B: byte-frozen carrier may bypass active_inner gate for parent UDP close. */
  carrierQuiesceBypass?: boolean
}): Hy2ParentRotationPlan {
  const minSessionAgeMs =
    input.carrierQuiesceBypass === true ? 0 : HY2_PARENT_ROTATE_AGE_MS
  if (
    !input.emergencyStallEscalation &&
    input.snapshot.outboundHy2SessionAgeMs < minSessionAgeMs &&
    input.snapshot.httpParentChainAgeMs < minSessionAgeMs
  ) {
    return { action: 'none', reason: 'session_age_below_threshold' }
  }
  if (input.nowMs - input.lastRotationAtMs < HY2_PARENT_ROTATION_COOLDOWN_MS) {
    return { action: 'none', reason: 'rotation_cooldown' }
  }
  const activeInner = countActiveInnerCriticalFlows({
    connections: input.connections,
    activeLeaf: input.snapshot.activeHy2Leaf,
  })
  if (activeInner > 0 && input.carrierQuiesceBypass !== true) {
    return { action: 'none', reason: 'active_inner_critical_flows' }
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
