import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countBug014RescueFailuresSinceLine } from './upgradeSparklePostInstallGateCore'

describe('upgradeSparklePostInstallGateCore', () => {
  it('counts only lines after install offset', () => {
    const log = [
      'old token_gap_nudge outcome=failed err={"message":"Resource not found"}',
      'install marker',
      'new connect_stream_keepalive_failed err={"message":"Resource not found"}',
      'ok token_gap_nudge outcome=executed',
    ].join('\n')
    assert.equal(countBug014RescueFailuresSinceLine(log, 2), 1)
    assert.equal(countBug014RescueFailuresSinceLine(log, 0), 2)
    assert.equal(countBug014RescueFailuresSinceLine(log, 99), 0)
  })
})
