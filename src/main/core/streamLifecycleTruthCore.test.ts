import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildStreamGenerationKey,
  countTerminalRecoveryCandidates,
  isStreamGenerationRecoveryEligible,
  reduceStreamLifecycleEvents,
  type StreamLifecycleEvent,
} from './streamLifecycleTruthCore'

function baseEvent(partial: Partial<StreamLifecycleEvent>): StreamLifecycleEvent {
  return {
    eventId: partial.eventId ?? 'e1',
    sequence: partial.sequence ?? 1,
    occurredAtMs: partial.occurredAtMs ?? 1_000,
    rendererBootId: partial.rendererBootId ?? 'boot-a',
    composerId: partial.composerId ?? 'composer-a',
    originalRequestId: partial.originalRequestId ?? 'orig-a',
    segmentRequestId: partial.segmentRequestId ?? 'seg-a',
    generation: partial.generation ?? 0,
    kind: partial.kind ?? 'physical_start',
    terminalKind: partial.terminalKind,
  }
}

describe('streamLifecycleTruthCore P10-1', () => {
  it('terminal generation is irreversible', () => {
    const key = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 0,
    })
    const state = reduceStreamLifecycleEvents([
      baseEvent({ sequence: 1, kind: 'physical_start' }),
      baseEvent({ sequence: 2, kind: 'terminal', terminalKind: 'server_eof' }),
      baseEvent({ sequence: 3, kind: 'activity', occurredAtMs: 2_000 }),
    ])
    assert.equal(state.get(key)?.phase, 'terminal')
    assert.equal(isStreamGenerationRecoveryEligible(state, key), false)
  })

  it('orders terminal before late activity when sequence says so', () => {
    const state = reduceStreamLifecycleEvents([
      baseEvent({ sequence: 1, kind: 'physical_start' }),
      baseEvent({ sequence: 3, kind: 'terminal', terminalKind: 'turn_ended' }),
      baseEvent({ sequence: 2, kind: 'activity', occurredAtMs: 1_500 }),
    ])
    const key = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 0,
    })
    assert.equal(state.get(key)?.phase, 'terminal')
  })

  it('keeps parallel composers isolated', () => {
    const state = reduceStreamLifecycleEvents([
      baseEvent({
        eventId: 'a1',
        composerId: 'c1',
        originalRequestId: 'o1',
        segmentRequestId: 's1',
        sequence: 1,
        kind: 'physical_start',
      }),
      baseEvent({
        eventId: 'b1',
        composerId: 'c2',
        originalRequestId: 'o2',
        segmentRequestId: 's2',
        sequence: 1,
        kind: 'physical_start',
      }),
      baseEvent({
        eventId: 'a2',
        composerId: 'c1',
        originalRequestId: 'o1',
        segmentRequestId: 's1',
        sequence: 2,
        kind: 'terminal',
        terminalKind: 'max_steps',
      }),
    ])
    assert.equal(countTerminalRecoveryCandidates(state), 1)
    const activeKey = buildStreamGenerationKey({
      composerId: 'c2',
      originalRequestId: 'o2',
      generation: 0,
    })
    assert.equal(isStreamGenerationRecoveryEligible(state, activeKey), true)
  })

  it('new generation key starts fresh after terminal', () => {
    const state = reduceStreamLifecycleEvents([
      baseEvent({ sequence: 1, generation: 0, kind: 'physical_start' }),
      baseEvent({ sequence: 2, generation: 0, kind: 'terminal', terminalKind: 'transport_error' }),
      baseEvent({ sequence: 3, generation: 1, kind: 'physical_start', segmentRequestId: 'seg-b' }),
    ])
    const gen0 = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 0,
    })
    const gen1 = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 1,
    })
    assert.equal(state.get(gen0)?.phase, 'terminal')
    assert.equal(state.get(gen1)?.phase, 'active')
  })

  it('renderer reboot starts new generation without reviving terminal gen-0', () => {
    const state = reduceStreamLifecycleEvents([
      baseEvent({
        sequence: 1,
        rendererBootId: 'boot-old',
        kind: 'physical_start',
      }),
      baseEvent({
        sequence: 2,
        rendererBootId: 'boot-old',
        kind: 'terminal',
        terminalKind: 'server_eof',
      }),
      baseEvent({
        sequence: 3,
        rendererBootId: 'boot-new',
        generation: 1,
        segmentRequestId: 'seg-reboot',
        kind: 'physical_start',
        occurredAtMs: 5_000,
      }),
    ])
    const gen0 = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 0,
    })
    const gen1 = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 1,
    })
    assert.equal(state.get(gen0)?.phase, 'terminal')
    assert.equal(state.get(gen1)?.phase, 'active')
    assert.equal(isStreamGenerationRecoveryEligible(state, gen0), false)
    assert.equal(isStreamGenerationRecoveryEligible(state, gen1), true)
  })

  it('duplicate terminal events are idempotent', () => {
    const state = reduceStreamLifecycleEvents([
      baseEvent({ sequence: 1, kind: 'physical_start' }),
      baseEvent({ sequence: 2, kind: 'terminal', terminalKind: 'max_steps' }),
      baseEvent({
        sequence: 3,
        kind: 'terminal',
        terminalKind: 'turn_ended',
        occurredAtMs: 3_000,
      }),
    ])
    const key = buildStreamGenerationKey({
      composerId: 'composer-a',
      originalRequestId: 'orig-a',
      generation: 0,
    })
    assert.equal(state.get(key)?.phase, 'terminal')
    assert.equal(state.get(key)?.terminalKind, 'max_steps')
  })
})
