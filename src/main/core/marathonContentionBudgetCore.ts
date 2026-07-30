// [INPUT] marathonTransportDialOrchestratorCore rescue triggers · marathonSSETruthCore pulse contract
// [OUTPUT] evaluateMarathonContentionBudget · buildMarathonContentionBreachKinds · isMarathonConnectPathGreen
// [POS] R-23/R-24 SSOT: green baseline observability cap; definitive breach kinds for cap bypass.

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
  | 'connect_partition_rescue_ineffective'
  | 'frozen_quic_cursor'
  | 'connect_partition'
  | 'latency_delta_rescue'
  | 'silent_generation_end'
  | 'cold_resume'

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

/** Inputs for R-24 breach SSOT — routine token_gap/connect_stream_gap are intentionally excluded. */
export interface MarathonContentionBreachInput {
  pulseContractBreach: boolean
  connectPathPartitionDetected: boolean
  connectPartitionPresent: boolean
  latencyDeltaRescueEligible: boolean
  silentGenerationEndPresent: boolean
  coldResumePresent: boolean
  tokenGapRescueIneffective: boolean
  connectPartitionRescueIneffective: boolean
  frozenQuicCursorCount: number
}

export interface BuildMarathonContentionBreachKindsOptions {
  /** Pulse contract breach bypass applies only to the 60s independent observability pulse. */
  forIndependentPulse: boolean
}

export function buildMarathonContentionBreachKinds(
  input: MarathonContentionBreachInput,
  options: BuildMarathonContentionBreachKindsOptions,
): MarathonContentionBreachKind[] {
  const kinds: MarathonContentionBreachKind[] = []
  if (options.forIndependentPulse && input.pulseContractBreach) {
    kinds.push('pulse_contract_breach')
  }
  if (input.connectPathPartitionDetected) {
    kinds.push('partition_stale_connect_path')
    kinds.push('connect_path_partition')
  }
  if (input.connectPartitionPresent) {
    kinds.push('connect_partition')
  }
  if (input.latencyDeltaRescueEligible) {
    kinds.push('latency_delta_rescue')
  }
  if (input.silentGenerationEndPresent) {
    kinds.push('silent_generation_end')
  }
  if (input.coldResumePresent) {
    kinds.push('cold_resume')
  }
  if (input.tokenGapRescueIneffective) {
    kinds.push('token_gap_rescue_ineffective')
  }
  if (input.connectPartitionRescueIneffective) {
    kinds.push('connect_partition_rescue_ineffective')
  }
  if (input.frozenQuicCursorCount > 0) {
    kinds.push('frozen_quic_cursor')
  }
  return kinds
}

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
