// [INPUT] stream lifecycle reducer · dial admission arbiter
// [OUTPUT] runP10ParallelComposerGate — 2/10/50 composer parallel invariant proof
// [POS] P10-6 §M.0.15.11.8 step 5 — parallel composers must not cross-contaminate lifecycle or admission.

import {
  countTerminalRecoveryCandidates,
  reduceStreamLifecycleEvents,
  type StreamLifecycleEvent,
} from './streamLifecycleTruthCore'
import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'

export const P10_PARALLEL_COMPOSER_COUNTS = [2, 10, 50] as const

export interface P10ParallelComposerCaseResult {
  composerCount: number
  ok: boolean
  recoveryCandidates: number
  controlInflightBlocked: boolean
  detail: string
}

export interface P10ParallelComposerGateResult {
  ok: boolean
  cases: P10ParallelComposerCaseResult[]
}

function buildParallelLifecycleEvents(composerCount: number): StreamLifecycleEvent[] {
  const events: StreamLifecycleEvent[] = []
  let sequence = 1
  for (let index = 0; index < composerCount; index += 1) {
    const composerId = `comp-${index}`
    const originalRequestId = `orig-${index}`
    events.push({
      eventId: `start:${originalRequestId}:1000`,
      sequence,
      occurredAtMs: 1000 + index,
      rendererBootId: 'boot-parallel',
      composerId,
      originalRequestId,
      segmentRequestId: `req-${index}`,
      generation: 0,
      kind: 'physical_start',
    })
    sequence += 1
  }
  const terminalIndex = Math.floor(composerCount / 2)
  events.push({
    eventId: `terminal:orig-${terminalIndex}:5000`,
    sequence,
    occurredAtMs: 5000,
    rendererBootId: 'boot-parallel',
    composerId: `comp-${terminalIndex}`,
    originalRequestId: `orig-${terminalIndex}`,
    segmentRequestId: `req-${terminalIndex}`,
    generation: 0,
    kind: 'terminal',
    terminalKind: 'server_eof',
  })
  return events
}

function verifyControlInflightLimit(composerCount: number): boolean {
  let state = createInitialDialAdmissionState()
  let admitted = 0
  let blocked = 0
  for (let index = 0; index < composerCount; index += 1) {
    const incident = `parallel-incident:${index}`
    const resolved = resolveDialAdmission(state, {
      dialId: `parallel-dial-${index}`,
      class: 'active_recovery',
      caller: 'parallel-gate',
      incidentGeneration: incident,
      submittedAtMs: index + 1,
    })
    if (resolved.admitted) {
      admitted += 1
      state = resolved.nextState
      state = markDialAdmissionOutcome(
        state,
        `parallel-dial-${index}`,
        incident,
        'SUCCESS',
      )
    } else {
      blocked += 1
    }
  }
  return admitted === composerCount && blocked === 0
}

export function runP10ParallelComposerGate(
  composerCounts: readonly number[] = P10_PARALLEL_COMPOSER_COUNTS,
): P10ParallelComposerGateResult {
  const cases: P10ParallelComposerCaseResult[] = []
  for (const composerCount of composerCounts) {
    const events = buildParallelLifecycleEvents(composerCount)
    const state = reduceStreamLifecycleEvents(events)
    const terminalIndex = Math.floor(composerCount / 2)
    const terminalKey = `comp-${terminalIndex}|orig-${terminalIndex}|0`
    const terminalOk = state.get(terminalKey)?.phase === 'terminal'
    let activeOk = true
    for (let index = 0; index < composerCount; index += 1) {
      if (index === terminalIndex) {
        continue
      }
      const key = `comp-${index}|orig-${index}|0`
      if (state.get(key)?.phase !== 'active') {
        activeOk = false
        break
      }
    }
    const recoveryCandidates = countTerminalRecoveryCandidates(state)
    const expectedRecovery = composerCount - 1
    const controlInflightBlocked = verifyControlInflightLimit(composerCount)
    const ok =
      terminalOk &&
      activeOk &&
      recoveryCandidates === expectedRecovery &&
      controlInflightBlocked
    cases.push({
      composerCount,
      ok,
      recoveryCandidates,
      controlInflightBlocked,
      detail: ok
        ? `isolated terminal comp-${terminalIndex}; recovery=${recoveryCandidates}`
        : `terminal=${terminalOk} active=${activeOk} recovery=${recoveryCandidates}/${expectedRecovery}`,
    })
  }
  return { ok: cases.every((item) => item.ok), cases }
}
