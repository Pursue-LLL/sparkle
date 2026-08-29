import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseDeferredProfileUpdateDueRecord,
  serializeDeferredProfileUpdateDueRecord,
  shouldExecuteDeferredProfileUpdateDue,
} from './deferredProfileUpdateDueCore'

describe('deferredProfileUpdateDueCore P2', () => {
  it('executes deferred update only when marathon guard is idle', () => {
    assert.equal(
      shouldExecuteDeferredProfileUpdateDue({
        quiesceActive: false,
        cursorConnectionCount: 0,
        recentActiveLifecycleStreamCount: 0,
        updatedAtMs: 1,
      }),
      true,
    )
    assert.equal(
      shouldExecuteDeferredProfileUpdateDue({
        quiesceActive: false,
        cursorConnectionCount: 2,
        recentActiveLifecycleStreamCount: 0,
        updatedAtMs: 1,
      }),
      false,
    )
  })

  it('round-trips deferred record JSON', () => {
    const record = { requestedAtMs: 123, source: 'second-instance' as const }
    const parsed = parseDeferredProfileUpdateDueRecord(serializeDeferredProfileUpdateDueRecord(record))
    assert.deepEqual(parsed, record)
  })
})
