// [INPUT] mihomo connection snapshots · carrier identity SSOT · active HY2 leaf
// [OUTPUT] planByteDeathParentMutation · selectByteDeathLeafCloseTargets · formatByteDeathRecoveryLogLine
// [POS] C-8.12 SSOT — byte-death parent mutation planner (UDP-first; no collateral leaf close when UDP absent).

import {
  resolveHy2ParentUdpOutboundConnectionId,
  type Hy2ParentUdpResolution,
} from './hy2ParentCarrierIdentityCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'

export const BYTE_DEATH_LEAF_CLOSE_MIN_STALL_MS = 90_000
/** Cap batch size — avoids mass ECONNRESET while still nudging HY2 parent session. */
export const BYTE_DEATH_LEAF_CLOSE_MAX_BATCH = 8
/** mihomo omits HY2 UDP parent rows — birth reset alone is ineffective; escalate core restart. */
export const BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART =
  'byte_death_udp_absent_requires_core_restart'

/** Scan incomplete or API untrusted — diagnostic only, no mutation. */
export const BYTE_DEATH_UDP_PARENT_UNKNOWN = 'byte_death_udp_parent_unknown'

export type UdpParentObservation = 'present' | 'absent' | 'unknown'

export type ByteDeathParentMutationAction =
  | 'none'
  | 'close_udp_outbound'
  | 'close_leaf_connections'
  | 'reset_parent_chain_birth'

export interface ByteDeathParentMutationPlan {
  action: ByteDeathParentMutationAction
  reason: string
  udpConnectionId?: string
  udpResolutionSource?: Hy2ParentUdpResolution['source']
  leafTargetCount?: number
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

export function resolveConnectionByteStallMs(
  connection: ControllerConnectionDetail,
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>,
  nowMs: number,
): number {
  const lastChangeMs = trackedLastByteChangeAtMsById.get(connection.id)
  if (lastChangeMs == null) {
    return Number.POSITIVE_INFINITY
  }
  return nowMs - lastChangeMs
}

export function selectByteDeathLeafCloseTargets(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
  minStallMs?: number
  maxBatch?: number
}): ControllerConnectionDetail[] {
  const minStallMs = input.minStallMs ?? BYTE_DEATH_LEAF_CLOSE_MIN_STALL_MS
  const maxBatch = input.maxBatch ?? BYTE_DEATH_LEAF_CLOSE_MAX_BATCH
  const leafConnections = filterHy2LeafConnections(input.connections, input.activeLeaf)
  const byteFrozen = leafConnections.filter((connection) => {
    const lastChangeMs = input.trackedLastByteChangeAtMsById.get(connection.id)
    if (lastChangeMs == null) {
      return false
    }
    const stallMs = resolveConnectionByteStallMs(
      connection,
      input.trackedLastByteChangeAtMsById,
      input.nowMs,
    )
    return stallMs >= minStallMs
  })
  const sortedFrozen = [...byteFrozen].sort(
    (left, right) =>
      resolveConnectionByteStallMs(right, input.trackedLastByteChangeAtMsById, input.nowMs) -
      resolveConnectionByteStallMs(left, input.trackedLastByteChangeAtMsById, input.nowMs),
  )
  if (sortedFrozen.length > 0) {
    return sortedFrozen.slice(0, maxBatch)
  }
  return []
}

export function classifyUdpParentObservation(
  resolution: Hy2ParentUdpResolution,
): UdpParentObservation {
  if (resolution.connectionId) {
    return 'present'
  }
  const diag = resolution.diagnostics
  if (!diag) {
    return 'unknown'
  }
  if (diag.udpOnLeafStrict <= 0 && diag.udpFullScanCandidates <= 0) {
    return 'absent'
  }
  return 'unknown'
}

/** Leaf TCP close is collateral during marathon when mihomo omits HY2 UDP parent rows. */

/** Recent successful connect_path dial proves the HY2 UDP parent is alive (contradicts 'absent'). */
export function isRecentVitalityDialSuccess(input: {
  lastVitalitySuccessAtMs: number | undefined
  nowMs: number
  freshnessMs?: number
}): boolean {
  const freshness = input.freshnessMs ?? VITALITY_DIAL_SUCCESS_FRESHNESS_MS
  return (
    typeof input.lastVitalitySuccessAtMs === 'number' &&
    input.lastVitalitySuccessAtMs > 0 &&
    input.nowMs - input.lastVitalitySuccessAtMs <= freshness
  )
}

/** Vitality dial success freshness window — recent success contradicts 'udp absent' triage. */
export const VITALITY_DIAL_SUCCESS_FRESHNESS_MS = 60_000

/** Stale HY2 session age overrides vitality counterproof — external dial failures prove parent dead. */
export const STALE_SESSION_OVERRIDES_VITALITY_COUNTERPROOF =
  'stale_session_overrides_vitality_counterproof'

export function shouldOverrideVitalityCounterproofForStaleSession(input: {
  outboundHy2SessionAgeMs?: number
  httpParentChainAgeMs?: number
  proactiveRotateAgeMs?: number
}): boolean {
  const threshold = input.proactiveRotateAgeMs ?? HY2_PARENT_SIDECAR_DIAL_AGE_MS
  const ageMs = Math.max(
    input.outboundHy2SessionAgeMs ?? 0,
    input.httpParentChainAgeMs ?? 0,
  )
  return ageMs >= threshold
}

/** Scan incomplete or recent vitality dial success — diagnostic only, no mutation/escalation. */
export const BYTE_DEATH_UDP_EVIDENCE_INSUFFICIENT = 'byte_death_udp_evidence_insufficient'

export function planByteDeathParentMutation(input: {
  connections: readonly ControllerConnectionDetail[]
  activeLeaf: string
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
  /** Recent successful vitality dial contradicts 'udp absent' — downgrade to diagnostic-only. */
  lastVitalitySuccessAtMs?: number
  outboundHy2SessionAgeMs?: number
  httpParentChainAgeMs?: number
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
  const udpObservation = classifyUdpParentObservation(resolution)
  if (udpObservation === 'absent') {
    const staleSessionOverridesVitality = shouldOverrideVitalityCounterproofForStaleSession(
      {
        outboundHy2SessionAgeMs: input.outboundHy2SessionAgeMs,
        httpParentChainAgeMs: input.httpParentChainAgeMs,
      },
    )
    if (
      isRecentVitalityDialSuccess({
        lastVitalitySuccessAtMs: input.lastVitalitySuccessAtMs,
        nowMs: input.nowMs,
      }) &&
      !staleSessionOverridesVitality
    ) {
      return {
        action: 'none',
        reason: BYTE_DEATH_UDP_EVIDENCE_INSUFFICIENT,
      }
    }
    // 整核冷重启已移除：重建父会话的唯一手段 = 关闭冻结叶连接，
    // 逼 mihomo 重建 HY2 UDP parent（无目标时交由协调器叶轮换）。
    const absentTargets = selectByteDeathLeafCloseTargets({
      connections: input.connections,
      activeLeaf: input.activeLeaf,
      trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
      nowMs: input.nowMs,
    })
    if (absentTargets.length > 0) {
      return {
        action: 'close_leaf_connections',
        reason: 'byte_death_udp_absent_close_leaf_rebuild',
        leafTargetCount: absentTargets.length,
      }
    }
    return {
      action: 'none',
      reason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
    }
  }
  if (udpObservation === 'unknown') {
    return {
      action: 'none',
      reason: BYTE_DEATH_UDP_PARENT_UNKNOWN,
    }
  }
  const leafTargets = selectByteDeathLeafCloseTargets({
    connections: input.connections,
    activeLeaf: input.activeLeaf,
    trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
    nowMs: input.nowMs,
  })
  if (leafTargets.length > 0) {
    return {
      action: 'close_leaf_connections',
      reason: 'byte_death_close_frozen_leaf_batch',
      leafTargetCount: leafTargets.length,
    }
  }
  return {
    action: 'reset_parent_chain_birth',
    reason: 'byte_death_no_frozen_leaf_parent_birth_reset',
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
  targets: readonly ControllerConnectionDetail[]
  closedIds: readonly string[]
  failedIds: readonly string[]
  err?: string
}): Hy2LeafConnectionCloseReport {
  const sampleChains = input.targets.slice(0, 3).map((conn) =>
    JSON.stringify(conn.chains ?? []),
  )
  return {
    activeLeaf: input.activeLeaf,
    attemptedCount: input.targets.length,
    closedCount: input.closedIds.length,
    failedCount: input.failedIds.length,
    sampleChains,
    err: input.err,
  }
}

export function isByteDeathNoUdpRotationSkip(input: {
  rotationReason: string
  marathonGlobalByteDeath: boolean
}): boolean {
  return input.marathonGlobalByteDeath && input.rotationReason === 'no_udp_outbound'
}
