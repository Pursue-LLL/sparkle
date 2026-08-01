// [INPUT] per-composer continuation intents and ACK facts
// [OUTPUT] reduceContinuationIntentState · validateContinuationAckTransition
// [POS] P10-4 SSOT — durable target-bound continuation journal (isolated E2E later).

export type StreamContinuationIntentPhase =
  | 'pending'
  | 'acknowledged'
  | 'failed'
  | 'unavailable'

export interface StreamContinuationIntentRecord {
  intentId: string
  composerId: string
  originalRequestId: string
  targetComposerId: string
  phase: StreamContinuationIntentPhase
  createdAtMs: number
  updatedAtMs: number
  reason?: string
  ackSource?: 'resume_current_chat' | 'manual' | 'replay'
}

export interface StreamContinuationIntentEvent {
  eventId: string
  sequence: number
  occurredAtMs: number
  composerId: string
  originalRequestId: string
  targetComposerId: string
  phase: StreamContinuationIntentPhase
  reason?: string
  ackSource?: StreamContinuationIntentRecord['ackSource']
}

export function buildContinuationIntentKey(composerId: string, originalRequestId: string): string {
  return `${composerId.trim()}|${originalRequestId.trim()}`
}

export function reduceContinuationIntentEvent(
  state: ReadonlyMap<string, StreamContinuationIntentRecord>,
  event: StreamContinuationIntentEvent,
): Map<string, StreamContinuationIntentRecord> {
  const key = buildContinuationIntentKey(event.composerId, event.originalRequestId)
  const prev = state.get(key)
  const next = new Map(state)
  next.set(key, {
    intentId: event.eventId,
    composerId: event.composerId,
    originalRequestId: event.originalRequestId,
    targetComposerId: event.targetComposerId,
    phase: event.phase,
    createdAtMs: prev?.createdAtMs ?? event.occurredAtMs,
    updatedAtMs: event.occurredAtMs,
    reason: event.reason,
    ackSource: event.ackSource,
  })
  return next
}

export function reduceContinuationIntentEvents(
  events: readonly StreamContinuationIntentEvent[],
): Map<string, StreamContinuationIntentRecord> {
  const sorted = [...events].sort(
    (a, b) => a.sequence - b.sequence || a.occurredAtMs - b.occurredAtMs,
  )
  let state = new Map<string, StreamContinuationIntentRecord>()
  for (const event of sorted) {
    state = reduceContinuationIntentEvent(state, event)
  }
  return state
}

export function validateContinuationAckTransition(input: {
  prev?: StreamContinuationIntentRecord
  nextPhase: StreamContinuationIntentPhase
}): { ok: boolean; detail: string } {
  const prevPhase = input.prev?.phase
  if (input.nextPhase === 'acknowledged') {
    if (prevPhase && prevPhase !== 'pending') {
      return { ok: false, detail: `ack from ${prevPhase} not allowed` }
    }
    return { ok: true, detail: 'pending→acknowledged' }
  }
  if (input.nextPhase === 'failed' || input.nextPhase === 'unavailable') {
    return { ok: true, detail: `${prevPhase ?? 'absent'}→${input.nextPhase}` }
  }
  if (input.nextPhase === 'pending' && prevPhase === 'acknowledged') {
    return { ok: false, detail: 'cannot reopen acknowledged intent' }
  }
  return { ok: true, detail: 'allowed' }
}

export function listPendingContinuationIntents(
  state: ReadonlyMap<string, StreamContinuationIntentRecord>,
): StreamContinuationIntentRecord[] {
  return [...state.values()].filter((record) => record.phase === 'pending')
}
