// [INPUT] HttpSegmentStartedSample · MarathonStreamRegistry · segment terminated ids
// [OUTPUT] evaluateMarathonSSETruth · resolvePulseSkippedReason · formatPulseContractBreachLine
// [POS] P24 SSOT: marathon pulse gate from httpStartMs parent-chain age (not registry firstActivityMs).

import type { HttpSegmentStartedSample } from './cursorSegmentHandoffCore'
import {
  parseHttpSegmentStartedLine,
  parseSegmentTerminatedId,
} from './cursorSegmentHandoffCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
} from './cursorHy2MarathonKeepaliveCore'
import {
  MTDO_CONNECT_PATH_PULSE_INTERVAL_MS,
  MTDO_MARATHON_STREAM_MIN_AGE_MS,
} from './marathonTransportDialOrchestratorCore'

export type PulseSkippedReason =
  | 'conn_below_threshold'
  | 'chain_age_below_threshold'
  | 'no_open_segment'
  | 'not_due_yet'
  | 'no_active_node'

export interface MarathonParentChainTruth {
  originalRequestId: string
  chainStartMs: number
  chainAgeMs: number
  openSegmentCount: number
  openToolCalls: number
}

export interface MarathonSSETruthResult {
  marathonTruthActive: boolean
  pulseContractDue: boolean
  openSegmentCount: number
  maxParentChainAgeMs: number
  parentChains: readonly MarathonParentChainTruth[]
}

export interface MarathonSSETruthInput {
  nowMs: number
  cursorConnectionCount: number
  segments: readonly HttpSegmentStartedSample[]
  terminatedSegmentIds: ReadonlySet<string>
  registry: MarathonStreamRegistry
  lastConnectPathPulseAtMs: number
  minChainAgeMs?: number
}

function resolveOpenToolCallsForParent(
  registry: MarathonStreamRegistry,
  originalRequestId: string,
): number {
  let maxOpen = 0
  for (const record of registry.records.values()) {
    if (record.originalRequestId === originalRequestId || record.requestId === originalRequestId) {
      maxOpen = Math.max(maxOpen, record.openToolCalls)
    }
  }
  return maxOpen
}

export function evaluateMarathonSSETruth(input: MarathonSSETruthInput): MarathonSSETruthResult {
  const minChainAgeMs = input.minChainAgeMs ?? MTDO_MARATHON_STREAM_MIN_AGE_MS
  const chainStartByParent = new Map<string, number>()
  const openSegmentsByParent = new Map<string, number>()

  for (const segment of input.segments) {
    const parentId = segment.originalRequestId.trim() || segment.requestId
    const prevStart = chainStartByParent.get(parentId)
    if (prevStart == null || segment.httpStartMs < prevStart) {
      chainStartByParent.set(parentId, segment.httpStartMs)
    }
    if (!input.terminatedSegmentIds.has(segment.segmentId)) {
      openSegmentsByParent.set(parentId, (openSegmentsByParent.get(parentId) ?? 0) + 1)
    }
  }

  const parentChains: MarathonParentChainTruth[] = []
  let openSegmentCount = 0
  let maxParentChainAgeMs = 0
  let marathonTruthActive = false

  for (const [originalRequestId, chainStartMs] of chainStartByParent) {
    const openCount = openSegmentsByParent.get(originalRequestId) ?? 0
    if (openCount <= 0) {
      continue
    }
    const chainAgeMs = Math.max(0, input.nowMs - chainStartMs)
    const openToolCalls = resolveOpenToolCallsForParent(input.registry, originalRequestId)
    openSegmentCount += openCount
    maxParentChainAgeMs = Math.max(maxParentChainAgeMs, chainAgeMs)
    parentChains.push({
      originalRequestId,
      chainStartMs,
      chainAgeMs,
      openSegmentCount: openCount,
      openToolCalls,
    })
    if (chainAgeMs >= minChainAgeMs || openToolCalls > 0) {
      marathonTruthActive = true
    }
  }

  const pulseContractDue =
    input.cursorConnectionCount >= CURSOR_HY2_MARATHON_CONN_THRESHOLD &&
    parentChains.some((chain) => chain.chainAgeMs >= minChainAgeMs && chain.openSegmentCount > 0)

  return {
    marathonTruthActive,
    pulseContractDue,
    openSegmentCount,
    maxParentChainAgeMs,
    parentChains,
  }
}

export function shouldRunPulseContract(
  truth: MarathonSSETruthResult,
  cursorConnectionCount: number,
  lastConnectPathPulseAtMs: number,
  nowMs: number,
): boolean {
  if (!truth.pulseContractDue) {
    return false
  }
  if (cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  if (lastConnectPathPulseAtMs <= 0) {
    return true
  }
  return nowMs - lastConnectPathPulseAtMs >= MTDO_CONNECT_PATH_PULSE_INTERVAL_MS
}

export function resolvePulseSkippedReason(
  truth: MarathonSSETruthResult,
  cursorConnectionCount: number,
  lastConnectPathPulseAtMs: number,
  nowMs: number,
  hasActiveNode: boolean,
): PulseSkippedReason | undefined {
  if (cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return 'conn_below_threshold'
  }
  if (truth.openSegmentCount <= 0) {
    return 'no_open_segment'
  }
  if (!truth.pulseContractDue) {
    return 'chain_age_below_threshold'
  }
  if (!hasActiveNode) {
    return 'no_active_node'
  }
  if (
    lastConnectPathPulseAtMs > 0 &&
    nowMs - lastConnectPathPulseAtMs < MTDO_CONNECT_PATH_PULSE_INTERVAL_MS
  ) {
    return 'not_due_yet'
  }
  return undefined
}

export function isPulseContractBreach(
  truth: MarathonSSETruthResult,
  lastConnectPathPulseAtMs: number,
  nowMs: number,
): boolean {
  if (!truth.pulseContractDue || lastConnectPathPulseAtMs <= 0) {
    return false
  }
  return nowMs - lastConnectPathPulseAtMs > MTDO_CONNECT_PATH_PULSE_INTERVAL_MS
}

export function formatPulseContractBreachLine(fields: {
  gapMs: number
  openSegmentCount: number
  maxParentChainAgeMs: number
  cursorConnectionCount: number
}): string {
  return (
    `[MarathonTransportDial]: pulse_contract_breach gap_ms=${fields.gapMs}` +
    ` open_segments=${fields.openSegmentCount}` +
    ` max_parent_chain_age_ms=${fields.maxParentChainAgeMs}` +
    ` cursor_conn=${fields.cursorConnectionCount}\n`
  )
}

export function formatPulseSkippedLine(reason: PulseSkippedReason, fields: Record<string, string | number>): string {
  const parts = [`[MarathonTransportDial]: pulse_skipped reason=${reason}`]
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`${key}=${value}`)
  }
  return `${parts.join(' ')}\n`
}

export function collectSegmentsFromIfmLines(lines: readonly string[]): {
  segments: HttpSegmentStartedSample[]
  terminatedSegmentIds: Set<string>
} {
  const latestBySegmentId = new Map<string, HttpSegmentStartedSample>()
  const terminatedSegmentIds = new Set<string>()
  for (const line of lines) {
    const started = parseHttpSegmentStartedLine(line)
    if (started) {
      latestBySegmentId.set(started.segmentId, started)
      continue
    }
    const terminatedId = parseSegmentTerminatedId(line)
    if (terminatedId) {
      terminatedSegmentIds.add(terminatedId)
    }
  }
  return {
    segments: [...latestBySegmentId.values()],
    terminatedSegmentIds,
  }
}
