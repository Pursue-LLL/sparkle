// [INPUT] append-only stream lifecycle events
// [OUTPUT] reduceStreamLifecycleEvents · isStreamGenerationRecoveryEligible
// [POS] P10-1 SSOT — single lifecycle projection ABSENT→ACTIVE→TERMINAL (irreversible).

export type StreamLifecyclePhase = 'absent' | 'active' | 'terminal'

export type StreamLifecycleEventKind = 'physical_start' | 'activity' | 'terminal'

export interface StreamLifecycleEvent {
  eventId: string
  sequence: number
  occurredAtMs: number
  rendererBootId: string
  composerId: string
  originalRequestId: string
  segmentRequestId: string
  generation: number
  kind: StreamLifecycleEventKind
  terminalKind?: string
}

export interface StreamGenerationState {
  phase: StreamLifecyclePhase
  terminalKind?: string
  terminalAtMs?: number
  lastSequence: number
  lastActivityAtMs?: number
  rendererBootId?: string
}

export function buildStreamGenerationKey(input: {
  composerId: string
  originalRequestId: string
  generation: number
}): string {
  return `${input.composerId.trim()}|${input.originalRequestId.trim()}|${input.generation}`
}

export function reduceStreamLifecycleEvent(
  state: ReadonlyMap<string, StreamGenerationState>,
  event: StreamLifecycleEvent,
): Map<string, StreamGenerationState> {
  const key = buildStreamGenerationKey(event)
  const prev = state.get(key) ?? { phase: 'absent', lastSequence: -1 }
  if (event.sequence < prev.lastSequence) {
    return new Map(state)
  }
  if (event.sequence === prev.lastSequence && prev.phase !== 'absent') {
    return new Map(state)
  }

  const next = new Map(state)
  if (prev.phase === 'terminal') {
    return next
  }

  switch (event.kind) {
    case 'physical_start':
      next.set(key, {
        phase: 'active',
        lastSequence: event.sequence,
        lastActivityAtMs: event.occurredAtMs,
        rendererBootId: event.rendererBootId,
      })
      break
    case 'activity':
      next.set(key, {
        phase: 'active',
        lastSequence: event.sequence,
        lastActivityAtMs: event.occurredAtMs,
        rendererBootId: event.rendererBootId,
        terminalKind: prev.terminalKind,
        terminalAtMs: prev.terminalAtMs,
      })
      break
    case 'terminal':
      next.set(key, {
        phase: 'terminal',
        terminalKind: event.terminalKind,
        terminalAtMs: event.occurredAtMs,
        lastSequence: event.sequence,
        lastActivityAtMs: prev.lastActivityAtMs ?? event.occurredAtMs,
        rendererBootId: event.rendererBootId,
      })
      break
  }
  return next
}

export function reduceStreamLifecycleEvents(
  events: readonly StreamLifecycleEvent[],
): Map<string, StreamGenerationState> {
  const sorted = [...events].sort(
    (a, b) => a.sequence - b.sequence || a.occurredAtMs - b.occurredAtMs,
  )
  let state = new Map<string, StreamGenerationState>()
  for (const event of sorted) {
    state = reduceStreamLifecycleEvent(state, event)
  }
  return state
}

export function isStreamGenerationRecoveryEligible(
  state: ReadonlyMap<string, StreamGenerationState>,
  key: string,
): boolean {
  return state.get(key)?.phase === 'active'
}

export function countTerminalRecoveryCandidates(
  state: ReadonlyMap<string, StreamGenerationState>,
): number {
  let count = 0
  for (const generation of state.values()) {
    if (generation.phase === 'active') {
      count += 1
    }
  }
  return count
}
