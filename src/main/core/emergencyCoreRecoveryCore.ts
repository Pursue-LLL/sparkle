// [INPUT] evidence · deadlines · cursor_conn snapshot
// [OUTPUT] evaluateEmergencyCoreRecoveryAdmission · formatEmergencyCoreRecoveryLogLine
// [POS] C-8.14 SSOT — evidence-gated emergency core recovery (bypasses cursor_conn guard).

import { BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART } from './hy2ParentByteDeathRecoveryCore'

export const EMERGENCY_CORE_RECOVERY_DRAIN_MS = 15_000
export const EMERGENCY_CORE_RECOVERY_MAX_WAIT_MS = 45_000
export const EMERGENCY_CORE_RECOVERY_COOLDOWN_MS = 120_000

export type EmergencyCoreRecoveryReason =
  | 'confirmed_udp_parent_absent'
  | 'proactive_hard_rotate_failed'

export interface EmergencyCoreRecoveryRequest {
  reason: EmergencyCoreRecoveryReason
  leafId: string
  evidenceReason: string
  cursorConnectionCount: number
  requestedAtMs: number
  deadlineMs: number
}

export interface EmergencyCoreRecoveryAdmission {
  admitted: boolean
  reason: string
  drainMs: number
}

const ALLOWED_EVIDENCE = new Set<string>([
  BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
  'byte_death_probe_only_without_udp_close',
  'cursor_dedicated_dial_failure_cluster_udp_absent',
  'proactive_hard_rotate_api2_anchor',
])

export function buildEmergencyCoreRecoveryDeadline(
  requestedAtMs: number,
): number {
  return requestedAtMs + EMERGENCY_CORE_RECOVERY_MAX_WAIT_MS
}

export function evaluateEmergencyCoreRecoveryCooldown(input: {
  nowMs: number
  lastCompletedAtMs: number
  /** BUG-013: prior emergency reported completed but api2 anchor was not verified — do not block retry. */
  lastReadinessApi2Verified?: boolean
}): { blocked: boolean; reason: string } {
  if (input.lastCompletedAtMs <= 0) {
    return { blocked: false, reason: 'emergency_cooldown_clear' }
  }
  if (input.lastReadinessApi2Verified === false) {
    return { blocked: false, reason: 'emergency_cooldown_bypass_unverified_readiness' }
  }
  const elapsedMs = input.nowMs - input.lastCompletedAtMs
  if (elapsedMs < EMERGENCY_CORE_RECOVERY_COOLDOWN_MS) {
    return { blocked: true, reason: 'emergency_cooldown_active' }
  }
  return { blocked: false, reason: 'emergency_cooldown_clear' }
}

export function evaluateEmergencyCoreRecoveryAdmission(input: {
  request: EmergencyCoreRecoveryRequest
  nowMs: number
  inFlight?: boolean
  lastCompletedAtMs?: number
  lastReadinessApi2Verified?: boolean
  /** BUG-016: require proxy-stack deadlock proof before cold restart. */
  stackDeadlockConfirmed?: boolean
}): EmergencyCoreRecoveryAdmission {
  const { request, nowMs } = input
  if (input.inFlight) {
    return { admitted: false, reason: 'emergency_recovery_in_flight', drainMs: 0 }
  }
  const cooldown = evaluateEmergencyCoreRecoveryCooldown({
    nowMs,
    lastCompletedAtMs: input.lastCompletedAtMs ?? 0,
    lastReadinessApi2Verified: input.lastReadinessApi2Verified,
  })
  if (cooldown.blocked) {
    return { admitted: false, reason: cooldown.reason, drainMs: 0 }
  }
  if (!request.leafId.trim()) {
    return { admitted: false, reason: 'emergency_leaf_missing', drainMs: 0 }
  }
  if (nowMs > request.deadlineMs) {
    return { admitted: false, reason: 'emergency_deadline_expired', drainMs: 0 }
  }
  if (!ALLOWED_EVIDENCE.has(request.evidenceReason.trim())) {
    return { admitted: false, reason: 'emergency_evidence_not_allowed', drainMs: 0 }
  }
  if (input.stackDeadlockConfirmed !== true) {
    return { admitted: false, reason: 'proxy_stack_not_confirmed_deadlock', drainMs: 0 }
  }
  const drainMs =
    request.cursorConnectionCount > 0 ? EMERGENCY_CORE_RECOVERY_DRAIN_MS : 0
  return { admitted: true, reason: 'emergency_admitted', drainMs }
}

export function formatEmergencyCoreRecoveryLogLine(input: {
  outcome: 'planned' | 'admitted' | 'blocked' | 'executed' | 'failed'
  reason: string
  leafId?: string
  cursorConn?: number
  drainMs?: number
  err?: string
}): string {
  const parts = [
    `[EmergencyCoreRecovery]: outcome=${input.outcome}`,
    `reason=${input.reason}`,
  ]
  if (input.leafId) {
    parts.push(`leaf=${input.leafId}`)
  }
  if (input.cursorConn != null) {
    parts.push(`cursor_conn=${input.cursorConn}`)
  }
  if (input.drainMs != null) {
    parts.push(`drain_ms=${input.drainMs}`)
  }
  if (input.err) {
    parts.push(`err=${input.err}`)
  }
  return `${parts.join(' ')}\n`
}
