import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runBug20260903ReplayGate } from './bug20260903ReplayCore'

describe('bug20260903ReplayCore BUG-2026-09-03-001', () => {
  it('passes Sep2 stall + Aug31 provider parity replay gate', async () => {
    const result = await runBug20260903ReplayGate()
    if (!result.ok) {
      for (const verdict of result.verdicts) {
        if (!verdict.ok) {
          console.error(`${verdict.fixtureId}: ${verdict.detail}`)
        }
      }
    }
    assert.equal(result.ok, true)
  })
})
