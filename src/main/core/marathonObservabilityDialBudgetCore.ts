// [INPUT] marathonDialToleranceCore
// [OUTPUT] shouldApplyMarathonObservabilityDialBudget · OBSERVABILITY_DIAL_PRIORITY · shouldSkipObservabilityDialWhenBusy
// [POS] P12 SSOT: Marathon 期间 observability dial 优先级与是否启用单槽预算。

import { MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD } from './marathonDialToleranceCore'

export const MARATHON_OBSERVABILITY_DIAL_CONN_THRESHOLD = MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD

export type ObservabilityDialKind =
  | 'user_explicit'
  | 'transport_pair'
  | 'session_nudge'
  | 'connect_stream_keepalive'
  | 'defer_check'

export interface MarathonObservabilityDialContext {
  cursorConnectionCount: number
  quiesceActive: boolean
}

export const OBSERVABILITY_DIAL_PRIORITY: Readonly<Record<ObservabilityDialKind, number>> = {
  user_explicit: 100,
  transport_pair: 50,
  session_nudge: 30,
  connect_stream_keepalive: 20,
  defer_check: 10,
}

export function shouldApplyMarathonObservabilityDialBudget(
  context: MarathonObservabilityDialContext,
): boolean {
  return (
    context.quiesceActive ||
    context.cursorConnectionCount >= MARATHON_OBSERVABILITY_DIAL_CONN_THRESHOLD
  )
}

export function shouldSkipObservabilityDialWhenBusy(kind: ObservabilityDialKind): boolean {
  return kind === 'session_nudge' || kind === 'connect_stream_keepalive'
}

export function observabilityDialPriority(kind: ObservabilityDialKind): number {
  return OBSERVABILITY_DIAL_PRIORITY[kind]
}

export function canObservabilityDialPreemptInFlight(
  requested: ObservabilityDialKind,
  inFlight: ObservabilityDialKind | null,
): boolean {
  if (!inFlight) {
    return true
  }
  return observabilityDialPriority(requested) > observabilityDialPriority(inFlight)
}
