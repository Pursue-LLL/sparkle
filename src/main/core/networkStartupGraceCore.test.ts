import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isCoreWithinStartupGrace,
  NETWORK_MONITOR_STARTUP_GRACE_MS,
  TUN_RESTART_MIN_CORE_AGE_MS
} from './networkStartupGraceCore'

describe('networkStartupGraceCore', () => {
  it('treats missing core ready timestamp as grace-active', () => {
    assert.equal(isCoreWithinStartupGrace(0, TUN_RESTART_MIN_CORE_AGE_MS, 1_000_000), true)
  })

  it('defers TUN restart during startup grace window', () => {
    const readyAt = 1_000_000
    assert.equal(
      isCoreWithinStartupGrace(readyAt, TUN_RESTART_MIN_CORE_AGE_MS, readyAt + 30_000),
      true
    )
    assert.equal(
      isCoreWithinStartupGrace(readyAt, TUN_RESTART_MIN_CORE_AGE_MS, readyAt + TUN_RESTART_MIN_CORE_AGE_MS),
      false
    )
  })

  it('exports monitor grace constant', () => {
    assert.equal(NETWORK_MONITOR_STARTUP_GRACE_MS, 45_000)
  })
})
