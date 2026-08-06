import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runBug20260806ControlPlaneReplayGate } from './bug20260806ControlPlaneReplayCore'

describe('bug20260806ControlPlaneReplayCore BUG-2026-08-06-001 @1.30.28', () => {
  it('passes all 8/6 mass disconnect control-plane replay fixtures', () => {
    const result = runBug20260806ControlPlaneReplayGate()
    for (const verdict of result.verdicts) {
      assert.equal(verdict.ok, true, `${verdict.fixtureId}: ${verdict.detail}`)
    }
    assert.equal(result.ok, true)
  })
})
