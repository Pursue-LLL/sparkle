// [INPUT] marathon segment cache · validated ledger stream_terminated rows
// [OUTPUT] buildStreamLifecycleEventsFromSources · resolveTerminalOriginalRequestIds
// [POS] P10-1 projection — ledger/segment → lifecycle reducer input.

import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'
import {
  buildStreamGenerationKey,
  reduceStreamLifecycleEvents,
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

export function resolveTerminalOriginalRequestIds(input: {
  segments: readonly MarathonSegmentCacheRecord[]
  ledgerTerminals: readonly ValidatedLedgerTerminalRow[]
}): Set<string> {
  const state = reduceStreamLifecycleEvents(buildStreamLifecycleEventsFromSources(input))
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

/** @internal test helper */
export function lifecycleKeyForSegment(segment: MarathonSegmentCacheRecord): string {
  return buildStreamGenerationKey({
    composerId: segment.composerId || 'unknown',
    originalRequestId: segment.originalRequestId,
    generation: 0,
  })
}
