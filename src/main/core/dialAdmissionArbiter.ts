// [INPUT] dialAdmissionArbiterCore
// [OUTPUT] admitDialIntent · completeDialIntent · resetDialAdmissionArbiterForTests
// [POS] P10-2 runtime — module-level admission state for non-production dials.

import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
  type DialAdmissionOutcome,
  type DialAdmissionState,
  type DialIntent,
} from './dialAdmissionArbiterCore'

let admissionState: DialAdmissionState = createInitialDialAdmissionState()

export function resetDialAdmissionArbiterForTests(): void {
  admissionState = createInitialDialAdmissionState()
}

export function getDialAdmissionStateForTests(): DialAdmissionState {
  return admissionState
}

export function admitDialIntent(intent: DialIntent): {
  admitted: boolean
  reason: string
} {
  const decision = resolveDialAdmission(admissionState, intent)
  admissionState = decision.nextState
  return { admitted: decision.admitted, reason: decision.reason }
}

export function completeDialIntent(
  dialId: string,
  incidentGeneration: string,
  outcome: DialAdmissionOutcome,
): void {
  admissionState = markDialAdmissionOutcome(admissionState, dialId, incidentGeneration, outcome)
}

export function buildRecoveryIncidentGeneration(
  trigger: string,
  staleRequestIds: readonly string[] | undefined,
  nowMs: number,
): string {
  const anchor = staleRequestIds?.[0]?.trim() || 'none'
  return `${trigger}:${anchor}:${Math.floor(nowMs / 60_000)}`
}
