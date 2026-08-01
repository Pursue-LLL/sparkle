import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildStreamLifecycleEventsFromSources,
  filterStaleRequestIdsForStreamLifecycle,
  resolveTerminalOriginalRequestIds,
} from './streamLifecycleProjectionCore'

describe('streamLifecycleProjectionCore P10-1', () => {
  it('marks ledger-terminated originalRequestId as non-recovery candidate', () => {
    const terminalIds = resolveTerminalOriginalRequestIds({
      segments: [
        {
          segmentId: 'seg-1',
          requestId: 'req-1',
          originalRequestId: 'orig-terminated',
          composerId: 'comp-a',
          actionCase: 'userMessage',
          httpStartMs: 1_000,
          recordedAtMs: 1_000,
        },
        {
          segmentId: 'seg-2',
          requestId: 'req-2',
          originalRequestId: 'orig-active',
          composerId: 'comp-b',
          actionCase: 'userMessage',
          httpStartMs: 2_000,
          recordedAtMs: 2_000,
        },
      ],
      ledgerTerminals: [
        {
          ts: 5_000,
          originalRequestId: 'orig-terminated',
          requestId: 'req-1',
          composerId: 'comp-a',
          isMaxSteps: false,
          terminalKind: 'server_eof',
        },
      ],
    })
    assert.equal(terminalIds.has('orig-terminated'), true)
    assert.equal(terminalIds.has('orig-active'), false)
    const filtered = filterStaleRequestIdsForStreamLifecycle(
      ['orig-terminated', 'orig-active'],
      terminalIds,
    )
    assert.deepEqual(filtered, ['orig-active'])
  })

  it('builds physical_start before terminal events', () => {
    const events = buildStreamLifecycleEventsFromSources({
      segments: [
        {
          segmentId: 'seg-1',
          requestId: 'req-1',
          originalRequestId: 'orig-a',
          composerId: 'comp-a',
          actionCase: 'userMessage',
          httpStartMs: 100,
          recordedAtMs: 100,
        },
      ],
      ledgerTerminals: [
        {
          ts: 200,
          originalRequestId: 'orig-a',
          isMaxSteps: true,
          terminalKind: 'max_steps',
        },
      ],
    })
    assert.equal(events.length, 2)
    assert.equal(events[0]?.kind, 'physical_start')
    assert.equal(events[1]?.kind, 'terminal')
  })
})
