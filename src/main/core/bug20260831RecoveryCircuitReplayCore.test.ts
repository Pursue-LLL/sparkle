import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runBug20260831RecoveryCircuitReplayGate } from './bug20260831RecoveryCircuitReplayCore'

describe('bug20260831RecoveryCircuitReplayCore BUG-2026-08-31-001 @1.30.43', () => {
  it('passes all 8/31 recovery circuit replay fixtures', () => {
    const result = runBug20260831RecoveryCircuitReplayGate()
    for (const verdict of result.verdicts) {
      assert.equal(verdict.ok, true, `${verdict.fixtureId}: ${verdict.detail}`)
    }
    assert.equal(result.ok, true)
  })
})
