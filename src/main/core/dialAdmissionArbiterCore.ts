// [INPUT] dial intents with provenance
// [OUTPUT] resolveDialAdmission · markDialOutcome
// [POS] P10-2 SSOT — single-flight non-production dial admission; production bypasses.

export type DialAdmissionClass =
  | 'production'
  | 'user_explicit'
  | 'passive'
  | 'active_recovery'

export type DialAdmissionOutcome = 'SUCCESS' | 'INEFFECTIVE' | 'INCONCLUSIVE'

export interface DialIntent {
  dialId: string
  class: DialAdmissionClass
  caller: string
  incidentGeneration: string
  streamGeneration?: string
  node?: string
  submittedAtMs: number
}

export interface DialAdmissionState {
  inFlightDialId?: string
  inFlightIncidentGeneration?: string
  closedIncidentGenerations: ReadonlySet<string>
}

export interface DialAdmissionDecision {
  admitted: boolean
  reason: string
  nextState: DialAdmissionState
}

export function createInitialDialAdmissionState(): DialAdmissionState {
  return { closedIncidentGenerations: new Set() }
}

export function resolveDialAdmission(
  state: DialAdmissionState,
  intent: DialIntent,
): DialAdmissionDecision {
  if (intent.class === 'production') {
    return {
      admitted: true,
      reason: 'production_bypass',
      nextState: state,
    }
  }
  if (intent.class === 'passive') {
    return {
      admitted: false,
      reason: 'passive_no_dial',
      nextState: state,
    }
  }
  if (!intent.caller.trim()) {
    return {
      admitted: false,
      reason: 'missing_provenance_caller',
      nextState: state,
    }
  }
  if (state.closedIncidentGenerations.has(intent.incidentGeneration)) {
    return {
      admitted: false,
      reason: 'incident_generation_closed',
      nextState: state,
    }
  }
  if (
    intent.class === 'active_recovery' &&
    state.inFlightDialId != null &&
    state.inFlightIncidentGeneration !== intent.incidentGeneration
  ) {
    return {
      admitted: false,
      reason: 'global_control_inflight',
      nextState: state,
    }
  }
  if (
    state.inFlightDialId != null &&
    state.inFlightIncidentGeneration === intent.incidentGeneration
  ) {
    return {
      admitted: false,
      reason: 'single_inflight_per_incident',
      nextState: state,
    }
  }
  if (intent.class === 'user_explicit') {
    return {
      admitted: true,
      reason: 'user_explicit_admitted',
      nextState: {
        ...state,
        inFlightDialId: intent.dialId,
        inFlightIncidentGeneration: intent.incidentGeneration,
      },
    }
  }
  return {
    admitted: true,
    reason: 'active_recovery_admitted',
    nextState: {
      ...state,
      inFlightDialId: intent.dialId,
      inFlightIncidentGeneration: intent.incidentGeneration,
    },
  }
}

export function markDialAdmissionOutcome(
  state: DialAdmissionState,
  dialId: string,
  incidentGeneration: string,
  outcome: DialAdmissionOutcome,
): DialAdmissionState {
  const nextClosed = new Set(state.closedIncidentGenerations)
  if (outcome === 'INEFFECTIVE') {
    nextClosed.add(incidentGeneration)
  }
  const clearInFlight =
    state.inFlightDialId === dialId && state.inFlightIncidentGeneration === incidentGeneration
  return {
    closedIncidentGenerations: nextClosed,
    inFlightDialId: clearInFlight ? undefined : state.inFlightDialId,
    inFlightIncidentGeneration: clearInFlight ? undefined : state.inFlightIncidentGeneration,
  }
}
