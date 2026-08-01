// [INPUT] stream lifecycle reducer · dial admission arbiter · physical SLO
// [OUTPUT] runP10FaultInjectionGate
// [POS] P10-6 fault matrix skeleton — event reorder/drop must not corrupt lifecycle or admission.

import { reduceStreamLifecycleEvents, type StreamLifecycleEvent } from './streamLifecycleTruthCore'
import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'

export interface P10FaultInjectionGateResult {
  ok: boolean
  cases: Array<{ name: string; ok: boolean; detail: string }>
}

function baseLifecycleEvents(): StreamLifecycleEvent[] {
  return [
    {
      eventId: 'start:orig-f:1000',
      sequence: 1,
      occurredAtMs: 1000,
      rendererBootId: 'boot-f',
      composerId: 'comp-f',
      originalRequestId: 'orig-f',
      segmentRequestId: 'req-f',
      generation: 0,
      kind: 'physical_start',
    },
    {
      eventId: 'terminal:orig-f:5000',
      sequence: 2,
      occurredAtMs: 5000,
      rendererBootId: 'boot-f',
      composerId: 'comp-f',
      originalRequestId: 'orig-f',
      segmentRequestId: 'req-f',
      generation: 0,
      kind: 'terminal',
      terminalKind: 'server_eof',
    },
  ]
}

export function runP10FaultInjectionGate(): P10FaultInjectionGateResult {
  const cases: P10FaultInjectionGateResult['cases'] = []

  const ordered = reduceStreamLifecycleEvents(baseLifecycleEvents())
  const orderedTerminal = [...ordered.values()].every((state) => state.phase === 'terminal')
  cases.push({
    name: 'lifecycle_ordered_terminal',
    ok: orderedTerminal,
    detail: orderedTerminal ? 'terminal irreversible' : 'ordered reduce failed',
  })

  const reordered = [...baseLifecycleEvents()].reverse()
  const reversedState = reduceStreamLifecycleEvents(reordered)
  const stillTerminal = reversedState.get('comp-f|orig-f|0')?.phase === 'terminal'
  cases.push({
    name: 'lifecycle_out_of_order_delivery',
    ok: stillTerminal,
    detail: stillTerminal ? 'sequence guard preserves terminal' : 'reorder corrupted lifecycle',
  })

  const droppedTerminal = reduceStreamLifecycleEvents(baseLifecycleEvents().slice(0, 1))
  const activeOnly = droppedTerminal.get('comp-f|orig-f|0')?.phase === 'active'
  cases.push({
    name: 'lifecycle_dropped_terminal',
    ok: activeOnly,
    detail: activeOnly ? 'missing terminal stays active' : 'drop caused false terminal',
  })

  let admissionState = createInitialDialAdmissionState()
  const incident = 'fault:orig-f:1'
  const first = resolveDialAdmission(admissionState, {
    dialId: 'fd1',
    class: 'active_recovery',
    caller: 'fault-test',
    incidentGeneration: incident,
    submittedAtMs: 1,
  })
  admissionState = first.nextState
  admissionState = markDialAdmissionOutcome(admissionState, 'fd1', incident, 'INEFFECTIVE')
  const second = resolveDialAdmission(admissionState, {
    dialId: 'fd2',
    class: 'active_recovery',
    caller: 'fault-test',
    incidentGeneration: incident,
    submittedAtMs: 2,
  })
  cases.push({
    name: 'admission_duplicate_after_ineffective',
    ok: first.admitted && !second.admitted,
    detail: second.reason,
  })

  const ok = cases.every((item) => item.ok)
  return { ok, cases }
}
