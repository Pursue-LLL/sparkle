// [INPUT] marathonTransportDialOrchestratorCore rescue triggers
// [OUTPUT] evaluateMarathonContentionBudget · isMarathonConnectPathGreen
// [POS] R-23 SSOT: green baseline observability cap — data plane supremacy during marathon.

import { isMarathonTransportDialRescueTrigger } from './marathonTransportDialOrchestratorCore'
import type { MarathonTransportDialTrigger } from './marathonTransportDialOrchestratorCore'

/** Connect path delay below this is treated as green baseline (ms). */
export const MARATHON_CONTENTION_GREEN_DELAY_MS = 400

/** Max one observability triple-pulse per this window when path is green (ms). */
export const MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS = 300_000

export type MarathonContentionBreachKind =
  | 'pulse_contract_breach'
  | 'partition_stale_connect_path'
  | 'connect_path_partition'
  | 'token_gap_rescue_ineffective'
  | 'frozen_quic_cursor'
  | 'connect_partition'
  | 'latency_delta_rescue'
  | 'silent_generation_end'
  | 'token_gap'
  | 'cold_resume'
  | 'connect_stream_gap'

export interface MarathonContentionBudgetInput {
  nowMs: number
  lastAuthoritativeConnectPathDelayMs: number | null
  lastObservabilityDialAtMs: number
  breachKinds: readonly MarathonContentionBreachKind[]
  dialTrigger?: MarathonTransportDialTrigger
  independentPulse: boolean
}

export type MarathonContentionBudgetAllowReason =
  | 'breach'
  | 'path_not_green'
  | 'cap_elapsed'
  | 'no_prior_delay_sample'
  | 'rescue_with_breach'

export type MarathonContentionBudgetDecision =
  | { outcome: 'allow'; reason: MarathonContentionBudgetAllowReason }
  | { outcome: 'deny'; reason: 'green_cap'; remainingMs: number }

export function isMarathonConnectPathGreen(delayMs: number | null | undefined): boolean {
  return (
    typeof delayMs === 'number' &&
    Number.isFinite(delayMs) &&
    delayMs > 0 &&
    delayMs < MARATHON_CONTENTION_GREEN_DELAY_MS
  )
}

export function hasMarathonContentionBreach(
  breachKinds: readonly MarathonContentionBreachKind[],
): boolean {
  return breachKinds.length > 0
}

export function resolveMarathonContentionCapRemainingMs(
  lastObservabilityDialAtMs: number,
  nowMs: number,
): number {
  if (lastObservabilityDialAtMs <= 0) {
    return 0
  }
  return Math.max(0, MARATHON_CONTENTION_GREEN_OBSERVABILITY_CAP_MS - (nowMs - lastObservabilityDialAtMs))
}

export function evaluateMarathonContentionBudget(
  input: MarathonContentionBudgetInput,
): MarathonContentionBudgetDecision {
  if (hasMarathonContentionBreach(input.breachKinds)) {
    const reason: MarathonContentionBudgetAllowReason =
      input.dialTrigger != null && isMarathonTransportDialRescueTrigger(input.dialTrigger)
        ? 'rescue_with_breach'
        : 'breach'
    return { outcome: 'allow', reason }
  }

  if (input.lastAuthoritativeConnectPathDelayMs == null || input.lastAuthoritativeConnectPathDelayMs <= 0) {
    return { outcome: 'allow', reason: 'no_prior_delay_sample' }
  }

  if (!isMarathonConnectPathGreen(input.lastAuthoritativeConnectPathDelayMs)) {
    return { outcome: 'allow', reason: 'path_not_green' }
  }

  const remainingMs = resolveMarathonContentionCapRemainingMs(
    input.lastObservabilityDialAtMs,
    input.nowMs,
  )
  if (remainingMs <= 0) {
    return { outcome: 'allow', reason: 'cap_elapsed' }
  }

  return { outcome: 'deny', reason: 'green_cap', remainingMs }
}

export function formatMarathonContentionBudgetLogLine(
  decision: MarathonContentionBudgetDecision,
  fields: {
    cursorConnectionCount: number
    independentPulse: boolean
    trigger?: MarathonTransportDialTrigger
    lastDelayMs?: number | null
  },
): string {
  const parts = [
    '[MarathonContentionBudget]:',
    `outcome=${decision.outcome}`,
    `independent_pulse=${fields.independentPulse ? 1 : 0}`,
    `cursor_conn=${fields.cursorConnectionCount}`,
  ]
  if (fields.trigger) {
    parts.push(`trigger=${fields.trigger}`)
  }
  if (fields.lastDelayMs != null && fields.lastDelayMs > 0) {
    parts.push(`last_connect_path_delay_ms=${fields.lastDelayMs}`)
  }
  if (decision.outcome === 'allow') {
    parts.push(`reason=${decision.reason}`)
  } else {
    parts.push(`reason=${decision.reason}`)
    parts.push(`remaining_ms=${decision.remainingMs}`)
  }
  return `${parts.join(' ')}\n`
}
