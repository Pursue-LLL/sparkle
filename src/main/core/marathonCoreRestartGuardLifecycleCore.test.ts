import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countRecentActiveLifecycleStreams } from './marathonCoreRestartGuardLifecycleCore'
import type { StreamLifecycleEvent } from './streamLifecycleTruthCore'

describe('marathonCoreRestartGuardLifecycleCore P10-1', () => {
  it('counts active generations within lookback', () => {
    const nowMs = 2_000_000
    const events: StreamLifecycleEvent[] = [
      {
        eventId: 'start:a:1000',
        sequence: 1,
        occurredAtMs: nowMs - 60_000,
        rendererBootId: 'boot-a',
        composerId: 'comp-a',
        originalRequestId: 'orig-a',
        segmentRequestId: 'req-a',
        generation: 0,
        kind: 'physical_start',
      },
      {
        eventId: 'terminal:b:2000',
        sequence: 2,
        occurredAtMs: nowMs - 30_000,
        rendererBootId: 'boot-a',
        composerId: 'comp-b',
        originalRequestId: 'orig-b',
        segmentRequestId: 'req-b',
        generation: 0,
        kind: 'terminal',
        terminalKind: 'server_eof',
      },
      {
        eventId: 'start:c:3000',
        sequence: 3,
        occurredAtMs: nowMs - 45 * 60_000,
        rendererBootId: 'boot-a',
        composerId: 'comp-c',
        originalRequestId: 'orig-c',
        segmentRequestId: 'req-c',
        generation: 0,
        kind: 'physical_start',
      },
    ]
    const count = countRecentActiveLifecycleStreams({ events, nowMs })
    assert.equal(count, 1)
  })

  it('ignores terminal generations even when activity is recent', () => {
    const nowMs = 3_000_000
    const events: StreamLifecycleEvent[] = [
      {
        eventId: 'start:x:1000',
        sequence: 1,
        occurredAtMs: nowMs - 10_000,
        rendererBootId: 'boot-x',
        composerId: 'comp-x',
        originalRequestId: 'orig-x',
        segmentRequestId: 'req-x',
        generation: 0,
        kind: 'physical_start',
      },
      {
        eventId: 'terminal:x:2000',
        sequence: 2,
        occurredAtMs: nowMs - 5_000,
        rendererBootId: 'boot-x',
        composerId: 'comp-x',
        originalRequestId: 'orig-x',
        segmentRequestId: 'req-x',
        generation: 0,
        kind: 'terminal',
        terminalKind: 'server_eof',
      },
    ]
    const count = countRecentActiveLifecycleStreams({ events, nowMs })
    assert.equal(count, 0)
  })
})
