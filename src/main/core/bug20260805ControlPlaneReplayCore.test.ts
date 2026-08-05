import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runBug20260805ControlPlaneReplayGate } from './bug20260805ControlPlaneReplayCore'

describe('bug20260805ControlPlaneReplayCore BUG-2026-08-05-001', () => {
  it('passes all 8/5 night control-plane replay fixtures @1.30.3', () => {
    const result = runBug20260805ControlPlaneReplayGate()
    for (const verdict of result.verdicts) {
      assert.equal(verdict.ok, true, `${verdict.fixtureId}: ${verdict.detail}`)
    }
    assert.equal(result.ok, true)
  })
})
