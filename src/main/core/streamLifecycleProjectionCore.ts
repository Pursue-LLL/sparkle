// [INPUT] marathon segment cache · validated ledger stream_terminated rows
// [OUTPUT] buildStreamLifecycleEventsFromSources · resolveTerminalOriginalRequestIds
// [POS] P10-1 projection — ledger/segment → lifecycle reducer input.

import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'
import {
  buildStreamGenerationKey,
  reduceStreamLifecycleEvents,
  type StreamGenerationState,
  type StreamLifecycleEvent,
} from './streamLifecycleTruthCore'
import type { ValidatedLedgerTerminalRow } from './validatedLedgerTerminalCore'

export function buildStreamLifecycleEventsFromSources(input: {
  segments: readonly MarathonSegmentCacheRecord[]
  ledgerTerminals: readonly ValidatedLedgerTerminalRow[]
  rendererBootId?: string
}): StreamLifecycleEvent[] {
  const rendererBootId = input.rendererBootId?.trim() || 'ledger-projection'
  const events: StreamLifecycleEvent[] = []
  let sequence = 1

  const startsByOriginal = new Map<string, MarathonSegmentCacheRecord>()
  for (const segment of input.segments) {
    const originalRequestId = segment.originalRequestId.trim()
    if (!originalRequestId) {
      continue
    }
    const prev = startsByOriginal.get(originalRequestId)
    if (!prev || segment.httpStartMs < prev.httpStartMs) {
      startsByOriginal.set(originalRequestId, segment)
    }
  }

  for (const segment of startsByOriginal.values()) {
    const generation = 0
    events.push({
      eventId: `start:${segment.originalRequestId}:${segment.httpStartMs}`,
      sequence: sequence++,
      occurredAtMs: segment.httpStartMs,
      rendererBootId,
      composerId: segment.composerId || 'unknown',
      originalRequestId: segment.originalRequestId,
      segmentRequestId: segment.requestId,
      generation,
      kind: 'physical_start',
    })
  }

  for (const terminal of input.ledgerTerminals) {
    const originalRequestId = terminal.originalRequestId.trim()
    if (!originalRequestId) {
      continue
    }
    const generation = typeof terminal.attempt === 'number' ? terminal.attempt : 0
    events.push({
      eventId: `terminal:${originalRequestId}:${terminal.ts}`,
      sequence: sequence++,
      occurredAtMs: terminal.ts,
      rendererBootId,
      composerId: terminal.composerId?.trim() || 'unknown',
      originalRequestId,
      segmentRequestId: terminal.requestId?.trim() || originalRequestId,
      generation,
      kind: 'terminal',
      terminalKind: terminal.terminalKind ?? terminal.streamPrimarySub ?? 'unknown',
    })
  }

  return events
}

export function resolveTerminalOriginalRequestIdsFromEvents(
  events: readonly StreamLifecycleEvent[],
): Set<string> {
  const state = reduceStreamLifecycleEvents(events)
  const terminalOriginalRequestIds = new Set<string>()
  for (const [key, generationState] of state.entries()) {
    if (generationState.phase !== 'terminal') {
      continue
    }
    const parts = key.split('|')
    const originalRequestId = parts[1]?.trim()
    if (originalRequestId) {
      terminalOriginalRequestIds.add(originalRequestId)
    }
  }
  return terminalOriginalRequestIds
}

export function resolveTerminalOriginalRequestIds(input: {
  segments: readonly MarathonSegmentCacheRecord[]
  ledgerTerminals: readonly ValidatedLedgerTerminalRow[]
}): Set<string> {
  return resolveTerminalOriginalRequestIdsFromEvents(buildStreamLifecycleEventsFromSources(input))
}

export function filterStaleRequestIdsForStreamLifecycle(
  staleRequestIds: readonly string[] | undefined,
  terminalOriginalRequestIds: ReadonlySet<string> | undefined,
): string[] {
  if (!staleRequestIds || staleRequestIds.length === 0) {
    return []
  }
  if (!terminalOriginalRequestIds || terminalOriginalRequestIds.size === 0) {
    return [...staleRequestIds]
  }
  return staleRequestIds.filter((rid) => !terminalOriginalRequestIds.has(rid.trim()))
}

export function isOriginalRequestTerminalInLifecycle(
  originalRequestId: string,
  terminalOriginalRequestIds: ReadonlySet<string> | undefined,
): boolean {
  if (!terminalOriginalRequestIds || terminalOriginalRequestIds.size === 0) {
    return false
  }
  return terminalOriginalRequestIds.has(originalRequestId.trim())
}

/** P10-1: lifecycle SSOT for marathon stream active — registry retained only for open-tool state. */
export function hasActiveMarathonStreamFromLifecycle(
  lifecycleState: ReadonlyMap<string, StreamGenerationState>,
  terminalOriginalRequestIds: ReadonlySet<string>,
  registry: MarathonStreamRegistry,
  nowMs: number,
  options: {
    minStreamAgeMs: number
    maxLastActivityGapMs: number
  },
): boolean {
  for (const [key, generation] of lifecycleState.entries()) {
    if (generation.phase !== 'active') {
      continue
    }
    const originalRequestId = key.split('|')[1]?.trim() ?? ''
    if (originalRequestId && terminalOriginalRequestIds.has(originalRequestId)) {
      continue
    }
    const anchorMs = generation.lastActivityAtMs ?? 0
    if (anchorMs <= 0) {
      continue
    }
    const streamAgeMs = nowMs - anchorMs
    if (streamAgeMs < options.minStreamAgeMs) {
      continue
    }
    if (nowMs - generation.lastActivityAtMs! <= options.maxLastActivityGapMs) {
      return true
    }
  }
  for (const record of registry.records.values()) {
    if (record.openToolCalls <= 0) {
      continue
    }
    if (terminalOriginalRequestIds.has(record.originalRequestId.trim())) {
      continue
    }
    const streamAgeMs = nowMs - record.firstActivityMs
    if (streamAgeMs >= options.minStreamAgeMs) {
      return true
    }
  }
  return false
}

export function reduceLifecycleStateFromEvents(
  events: readonly StreamLifecycleEvent[],
): Map<string, StreamGenerationState> {
  return reduceStreamLifecycleEvents(events)
}

/** @internal test helper */
export function lifecycleKeyForSegment(segment: MarathonSegmentCacheRecord): string {
  return buildStreamGenerationKey({
    composerId: segment.composerId || 'unknown',
    originalRequestId: segment.originalRequestId,
    generation: 0,
  })
}
