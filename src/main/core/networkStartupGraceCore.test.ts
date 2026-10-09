import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'

describe('networkStartupGraceCore', () => {
  it('exports monitor grace constant', () => {
    assert.equal(NETWORK_MONITOR_STARTUP_GRACE_MS, 45_000)
  })
})
