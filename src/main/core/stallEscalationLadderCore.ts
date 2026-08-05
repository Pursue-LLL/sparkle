// [INPUT] MihomoQuicSilentStallObservation · vitality byte snapshots · sidecar cooldown
// [OUTPUT] resolveStallEscalationLadderPlan · recordVitalityByteSnapshot · isVitalityIneffectiveForConnection
// [POS] R-41 SSOT — vitality 无效后逐级 escalation；critical host 永不禁关 inner TCP。

import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import { MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS } from './mihomoQuicSilentStallCore'

/** Bytes unchanged this long after vitality → ineffective (f1ee553d @88s class). */
export const STALL_ESCALATION_VITALITY_INEFFECTIVE_MS = 15_000

/** Emergency parent sidecar when byte-frozen + vitality ineffective (bypass 4h age gate). */
export const STALL_ESCALATION_EMERGENCY_SIDECAR_MS = 60_000

/** Parent UDP refresh rung when emergency sidecar did not restore bytes. */
export const STALL_ESCALATION_PARENT_UDP_REFRESH_MS = 90_000

export const STALL_ESCALATION_EMERGENCY_COOLDOWN_MS = 120_000

export type StallEscalationLadderAction =
  | 'none'
  | 'emergency_sidecar_dial'
  | 'parent_udp_refresh'
  | 'observe_exhausted'

export interface StallEscalationLadderPlan {
  action: StallEscalationLadderAction
  reason: string
}

interface VitalityByteSnapshot {
  totalBytes: number
  recordedAtMs: number
}

const vitalityByteSnapshotByConnectionId = new Map<string, VitalityByteSnapshot>()
const lastEmergencyEscalationAtMsByConnectionId = new Map<string, number>()
const parentUdpRefreshAttemptCountByConnectionId = new Map<string, number>()

export function resetStallEscalationLadderStateForTests(): void {
  vitalityByteSnapshotByConnectionId.clear()
  lastEmergencyEscalationAtMsByConnectionId.clear()
  parentUdpRefreshAttemptCountByConnectionId.clear()
}

export function recordVitalityByteSnapshot(input: {
  connectionId: string
  upload: number
  download: number
  nowMs: number
}): void {
  const connectionId = input.connectionId.trim()
  if (!connectionId) {
    return
  }
  vitalityByteSnapshotByConnectionId.set(connectionId, {
    totalBytes: Math.max(0, input.upload) + Math.max(0, input.download),
    recordedAtMs: input.nowMs
  })
}

export function isVitalityIneffectiveForConnection(input: {
  connectionId: string
  upload: number
  download: number
  nowMs: number
}): boolean {
  const connectionId = input.connectionId.trim()
  if (!connectionId) {
    return false
  }
  const snapshot = vitalityByteSnapshotByConnectionId.get(connectionId)
  if (!snapshot) {
    return false
  }
  if (input.nowMs - snapshot.recordedAtMs < STALL_ESCALATION_VITALITY_INEFFECTIVE_MS) {
    return false
  }
  const currentBytes = Math.max(0, input.upload) + Math.max(0, input.download)
  return currentBytes === snapshot.totalBytes
}

export function resolveCriticalHostCloseDenialPlan(
  host: string | undefined
): StallEscalationLadderPlan | undefined {
  const trimmed = host?.trim() ?? ''
  if (!trimmed || !isCriticalCursorHost(trimmed)) {
    return undefined
  }
  return {
    action: 'none',
    reason: 'r41_critical_host_no_close'
  }
}

export function resolveStallEscalationLadderPlan(input: {
  observation: MihomoQuicSilentStallObservation
  upload: number
  download: number
  nowMs: number
  requestBoundStallProof: boolean
  /** Bypass R2 cooldown when global inner-carrier byte-death is proven. */
  marathonGlobalByteDeath?: boolean
}): StallEscalationLadderPlan {
  const { observation, nowMs } = input
  if (!input.requestBoundStallProof) {
    return { action: 'none', reason: 'missing_request_bound_stall_proof' }
  }
  if (observation.kind !== 'single') {
    return { action: 'none', reason: 'aggregate_observation' }
  }
  const host = observation.host?.trim() ?? ''
  if (!host || !isCriticalCursorHost(host)) {
    return { action: 'none', reason: 'non_critical_host' }
  }
  if (observation.stallMs < MIHOMO_QUIC_STALL_BYTE_UNCHANGED_MS) {
    return { action: 'none', reason: 'below_byte_frozen_threshold' }
  }

  const connectionId = observation.connectionId?.trim() ?? ''
  if (!connectionId) {
    return { action: 'none', reason: 'missing_connection_id' }
  }

  const vitalityIneffective = isVitalityIneffectiveForConnection({
    connectionId,
    upload: input.upload,
    download: input.download,
    nowMs
  })
  if (!vitalityIneffective && observation.stallMs < STALL_ESCALATION_EMERGENCY_SIDECAR_MS) {
    return { action: 'none', reason: 'awaiting_vitality_or_stall_threshold' }
  }

  const lastEmergencyAtMs = lastEmergencyEscalationAtMsByConnectionId.get(connectionId) ?? 0
  const emergencyCooldownOk =
    input.marathonGlobalByteDeath === true ||
    nowMs - lastEmergencyAtMs >= STALL_ESCALATION_EMERGENCY_COOLDOWN_MS
  if (
    observation.stallMs >= STALL_ESCALATION_EMERGENCY_SIDECAR_MS &&
    vitalityIneffective &&
    emergencyCooldownOk
  ) {
    if (observation.stallMs < STALL_ESCALATION_PARENT_UDP_REFRESH_MS) {
      return { action: 'emergency_sidecar_dial', reason: 'emergency_stall_escalation_r1' }
    }
  }

  const refreshAttempts = parentUdpRefreshAttemptCountByConnectionId.get(connectionId) ?? 0
  if (
    observation.stallMs >= STALL_ESCALATION_PARENT_UDP_REFRESH_MS &&
    vitalityIneffective &&
    refreshAttempts < 2 &&
    emergencyCooldownOk
  ) {
    return { action: 'parent_udp_refresh', reason: 'emergency_stall_escalation_r2' }
  }

  if (vitalityIneffective && observation.stallMs >= STALL_ESCALATION_EMERGENCY_SIDECAR_MS) {
    return { action: 'observe_exhausted', reason: 'emergency_stall_escalation_r3_exhausted' }
  }

  return { action: 'none', reason: 'escalation_not_due' }
}

export function markStallEscalationExecuted(input: {
  connectionId: string
  action: StallEscalationLadderAction
  nowMs: number
}): void {
  const connectionId = input.connectionId.trim()
  if (!connectionId) {
    return
  }
  if (input.action === 'emergency_sidecar_dial' || input.action === 'parent_udp_refresh') {
    lastEmergencyEscalationAtMsByConnectionId.set(connectionId, input.nowMs)
  }
  if (input.action === 'parent_udp_refresh') {
    const prior = parentUdpRefreshAttemptCountByConnectionId.get(connectionId) ?? 0
    parentUdpRefreshAttemptCountByConnectionId.set(connectionId, prior + 1)
  }
}

export function formatStallEscalationLadderLogLine(fields: {
  outcome: 'executed' | 'skipped' | 'failed' | 'observe'
  action: StallEscalationLadderAction
  reason: string
  connectionId?: string
  host?: string
  stallMs: number
  upload: number
  download: number
  err?: string
}): string {
  const parts = [
    '[StallEscalationLadder]:',
    `outcome=${fields.outcome}`,
    `action=${fields.action}`,
    `reason=${fields.reason}`,
    `stall_ms=${fields.stallMs}`,
    `upload=${fields.upload}`,
    `download=${fields.download}`
  ]
  if (fields.connectionId) {
    parts.push(`connection_id=${fields.connectionId}`)
  }
  if (fields.host) {
    parts.push(`host=${fields.host}`)
  }
  if (fields.err) {
    parts.push(`err=${fields.err}`)
  }
  return `${parts.join(' ')}\n`
}
