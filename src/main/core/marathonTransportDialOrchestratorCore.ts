// [INPUT] MarathonWarmthTrigger · ConnectPartitionSignal · MarathonStreamTokenGapSignal
// [OUTPUT] selectMarathonTransportDialTrigger · shouldRunIndependentConnectPathPulse · shouldCoalesceMarathonTransportDial
// [POS] MTDO pure SSOT: trigger priority · coalesce · dial plan. Independent 60s connect_path pulse (§23 P15).

import type { ConnectPartitionSignal } from './connectPartitionDetectCore'
import type { MarathonWarmthTrigger } from './cursorHy2MarathonKeepaliveCore'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_NUDGE_DEFER_THRESHOLD,
} from './cursorHy2MarathonKeepaliveCore'
import type { MarathonStreamTokenGapSignal } from './cursorStreamTokenGapCore'

export const MTDO_COALESCE_MS = 15_000
export const MTDO_CONNECT_PATH_PULSE_INTERVAL_MS = 60_000
export const MTDO_MARATHON_STREAM_MIN_AGE_MS = 1_800_000
export const MTDO_ACTIVE_STREAM_MAX_GAP_MS = 120_000
export const MTDO_LATENCY_DELTA_THRESHOLD_MS = 150
export const MTDO_LATENCY_DELTA_MIN_SAMPLES = 5

export type MarathonTransportDialTrigger = MarathonWarmthTrigger

export type MarathonTransportDialPlan =
  | 'connect_rescue_bundle'
  | 'session_rescue_bundle'
  | 'session_warmth_bundle'

export interface MarathonTransportDialCandidate {
  trigger: MarathonTransportDialTrigger
  plan: MarathonTransportDialPlan
  maxGapMs?: number
  staleRequestIdCount?: number
  staleRequestIds?: string[]
  partitionStaleConnectPath?: boolean
}

export interface MarathonTransportDialSelectionContext {
  nowMs: number
  cursorConnectionCount: number
  lastDialAtMs: number
  lastConnectPathPulseAtMs: number
  latencyDeltaHigh: boolean
  latencyDeltaRescueEligible: boolean
  connectPartition?: ConnectPartitionSignal
  silentGenerationEnd?: MarathonStreamTokenGapSignal
  coldResume?: MarathonStreamTokenGapSignal
  tokenGap?: MarathonStreamTokenGapSignal
  connectStreamGap?: MarathonStreamTokenGapSignal
  connectPathPartitionDetected: boolean
  tokenGapSuppressedPendingTool: boolean
  /** @deprecated P24 — pulse uses marathonTruthPulseDue; kept for tests. */
  marathonStreamActive: boolean
  /** P24: pulse contract gate from httpStartMs parent-chain age. */
  marathonTruthPulseDue: boolean
  forceHighLatencyWarmth: boolean
}

const TRIGGER_PRIORITY: readonly MarathonTransportDialTrigger[] = [
  'connect_partition',
  'latency_delta_rescue',
  'silent_generation_end',
  'connect_path_partition',
  'token_gap',
  'cold_resume',
  'marathon_connect_path_pulse',
  'high_latency_warmth',
  'periodic_session',
]

function isRescueTrigger(trigger: MarathonTransportDialTrigger): boolean {
  return (
    trigger === 'connect_partition' ||
    trigger === 'latency_delta_rescue' ||
    trigger === 'silent_generation_end' ||
    trigger === 'connect_path_partition' ||
    trigger === 'token_gap' ||
    trigger === 'cold_resume'
  )
}

export function resolveMarathonTransportDialPlan(
  trigger: MarathonTransportDialTrigger,
): MarathonTransportDialPlan {
  switch (trigger) {
    case 'marathon_connect_path_pulse':
      return 'connect_rescue_bundle'
    case 'connect_partition':
    case 'latency_delta_rescue':
    case 'silent_generation_end':
    case 'connect_path_partition':
    case 'token_gap':
      return 'connect_rescue_bundle'
    case 'cold_resume':
      return 'session_rescue_bundle'
    case 'high_latency_warmth':
    case 'periodic_session':
      return 'session_warmth_bundle'
  }
}

/** P24: independent 60s cadence — gated on MarathonSSETruth parent-chain age, not registry tail age. */
export function shouldRunIndependentConnectPathPulse(
  context: MarathonTransportDialSelectionContext,
): boolean {
  if (context.cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  if (!context.marathonTruthPulseDue) {
    return false
  }
  if (context.lastConnectPathPulseAtMs <= 0) {
    return true
  }
  return context.nowMs - context.lastConnectPathPulseAtMs >= MTDO_CONNECT_PATH_PULSE_INTERVAL_MS
}

export function selectMarathonTransportDialTrigger(
  context: MarathonTransportDialSelectionContext,
): MarathonTransportDialCandidate | undefined {
  const candidates: MarathonTransportDialCandidate[] = []

  if (context.connectPartition) {
    candidates.push({
      trigger: 'connect_partition',
      plan: resolveMarathonTransportDialPlan('connect_partition'),
      staleRequestIds: context.connectPartition.sampleRequestIds,
      staleRequestIdCount: context.connectPartition.sampleRequestIds.length,
    })
  }

  if (context.latencyDeltaRescueEligible) {
    candidates.push({
      trigger: 'latency_delta_rescue',
      plan: resolveMarathonTransportDialPlan('latency_delta_rescue'),
    })
  }

  if (context.silentGenerationEnd) {
    candidates.push({
      trigger: 'silent_generation_end',
      plan: resolveMarathonTransportDialPlan('silent_generation_end'),
      maxGapMs: context.silentGenerationEnd.maxGapMs,
      staleRequestIdCount: context.silentGenerationEnd.staleRequestIds.length,
      staleRequestIds: context.silentGenerationEnd.staleRequestIds,
    })
  }

  if (context.connectPathPartitionDetected) {
    const gap = context.connectStreamGap ?? context.tokenGap ?? context.silentGenerationEnd
    candidates.push({
      trigger: 'connect_path_partition',
      plan: resolveMarathonTransportDialPlan('connect_path_partition'),
      maxGapMs: gap?.maxGapMs,
      staleRequestIdCount: gap?.staleRequestIds.length ?? 0,
      staleRequestIds: gap?.staleRequestIds,
      partitionStaleConnectPath: true,
    })
  }

  if (context.tokenGap && !context.tokenGapSuppressedPendingTool) {
    candidates.push({
      trigger: 'token_gap',
      plan: resolveMarathonTransportDialPlan('token_gap'),
      maxGapMs: context.tokenGap.maxGapMs,
      staleRequestIdCount: context.tokenGap.staleRequestIds.length,
      staleRequestIds: context.tokenGap.staleRequestIds,
    })
  }

  if (context.coldResume) {
    candidates.push({
      trigger: 'cold_resume',
      plan: resolveMarathonTransportDialPlan('cold_resume'),
      maxGapMs: context.coldResume.maxGapMs,
      staleRequestIdCount: context.coldResume.staleRequestIds.length,
      staleRequestIds: context.coldResume.staleRequestIds,
    })
  }

  if (context.forceHighLatencyWarmth && !context.latencyDeltaHigh) {
    candidates.push({
      trigger: 'high_latency_warmth',
      plan: resolveMarathonTransportDialPlan('high_latency_warmth'),
    })
  }

  if (!context.latencyDeltaHigh) {
    candidates.push({
      trigger: 'periodic_session',
      plan: resolveMarathonTransportDialPlan('periodic_session'),
    })
  }

  for (const priorityTrigger of TRIGGER_PRIORITY) {
    const match = candidates.find((candidate) => candidate.trigger === priorityTrigger)
    if (match) {
      return match
    }
  }

  return undefined
}

export function shouldCoalesceMarathonTransportDial(
  context: MarathonTransportDialSelectionContext,
  candidate: MarathonTransportDialCandidate,
): boolean {
  if (context.lastDialAtMs <= 0) {
    return false
  }
  if (context.nowMs - context.lastDialAtMs >= MTDO_COALESCE_MS) {
    return false
  }
  return !isRescueTrigger(candidate.trigger)
}

export function isMarathonTransportDialRescueTrigger(
  trigger: MarathonTransportDialTrigger,
): boolean {
  return isRescueTrigger(trigger)
}

export function shouldBypassWarmthDeferForMtdo(
  cursorConnectionCount: number,
  trigger: MarathonTransportDialTrigger,
  staleRequestIdCount: number,
): boolean {
  if (isRescueTrigger(trigger)) {
    return true
  }
  return (
    cursorConnectionCount >= CURSOR_HY2_NUDGE_DEFER_THRESHOLD &&
    staleRequestIdCount > 0 &&
    (trigger === 'token_gap' || trigger === 'connect_path_partition')
  )
}
