// [INPUT] vitality timestamps · failover state · cursor dedicated leaf selection
// [OUTPUT] resolveUdpParentStateForRecovery · failover soak / failback guards
// [POS] BUG-2026-09-03-004 SSOT — block false UDP-absent escalation; HY2 failback after mistaken failover.

import type { Hy2ParentUdpResolution } from './hy2ParentCarrierIdentityCore'
import {
  classifyUdpParentObservation,
  isRecentVitalityDialSuccess,
  type UdpParentObservation,
  VITALITY_DIAL_SUCCESS_FRESHNESS_MS,
} from './hy2ParentByteDeathRecoveryCore'

export const DEFAULT_CURSOR_HY2_LEAF = 'JP-VPS-HY2'

/** Soak window after failover before another UDP-absent escalation (matches Sep3 5s gap bug). */
export const FAILOVER_SOAK_WINDOW_MS = 60_000

/** Failover targets that must not stay bound during marathon when HY2 vitality is healthy. */
export const MARATHON_FAILOVER_TCP_LEAVES = new Set(['JP-VPS-Reality', 'JP-VPS-TLS'])

export function resolveUdpParentStateForRecovery(input: {
  resolution: Hy2ParentUdpResolution
  lastVitalitySuccessAtMs?: number
  nowMs: number
}): UdpParentObservation {
  const observation = classifyUdpParentObservation(input.resolution)
  if (
    observation === 'absent' &&
    isRecentVitalityDialSuccess({
      lastVitalitySuccessAtMs: input.lastVitalitySuccessAtMs,
      nowMs: input.nowMs,
      freshnessMs: VITALITY_DIAL_SUCCESS_FRESHNESS_MS,
    })
  ) {
    return 'unknown'
  }
  return observation
}

export function isFailoverSoakWindowActive(input: {
  lastFailoverCompletedAtMs: number
  nowMs: number
  soakWindowMs?: number
}): boolean {
  const soak = input.soakWindowMs ?? FAILOVER_SOAK_WINDOW_MS
  return (
    input.lastFailoverCompletedAtMs > 0 &&
    input.nowMs - input.lastFailoverCompletedAtMs < soak
  )
}

export function shouldSuppressHy2UdpAbsentEscalation(input: {
  hy2LeafId: string
  cursorDedicatedActiveLeaf: string | undefined
}): boolean {
  const active = input.cursorDedicatedActiveLeaf?.trim() ?? ''
  const hy2 = input.hy2LeafId.trim()
  if (!active || !hy2 || active === hy2) {
    return false
  }
  return MARATHON_FAILOVER_TCP_LEAVES.has(active)
}

export function shouldFailbackCursorDedicatedToHy2(input: {
  currentLeaf: string | undefined
  preferredHy2Leaf?: string
  lastVitalitySuccessAtMs: number | undefined
  nowMs: number
}): { failback: boolean; reason: string; targetLeaf: string } {
  const targetLeaf = input.preferredHy2Leaf ?? DEFAULT_CURSOR_HY2_LEAF
  const current = input.currentLeaf?.trim() ?? ''
  if (!current || current === targetLeaf) {
    return { failback: false, reason: 'already_on_hy2_leaf', targetLeaf }
  }
  if (!MARATHON_FAILOVER_TCP_LEAVES.has(current)) {
    return { failback: false, reason: 'current_leaf_not_tcp_failover_target', targetLeaf }
  }
  if (
    !isRecentVitalityDialSuccess({
      lastVitalitySuccessAtMs: input.lastVitalitySuccessAtMs,
      nowMs: input.nowMs,
    })
  ) {
    return { failback: false, reason: 'hy2_vitality_not_recent', targetLeaf }
  }
  return { failback: true, reason: 'hy2_vitality_confirmed_failback', targetLeaf }
}
