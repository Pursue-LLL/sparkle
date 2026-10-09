import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  NETWORK_MONITOR_STARTUP_GRACE_MS
} from './networkStartupGraceCore'
import {
  getLastCoreReadyAtMs,
  markCoreReadyAtMs,
  resetCoreReadyTimestampForTests,
  safeGetLastCoreReadyAtMs,
} from './coreReadyTimestamp'

describe('networkStartupGraceCore', () => {
  it('exports monitor grace constant', () => {
    assert.equal(NETWORK_MONITOR_STARTUP_GRACE_MS, 45_000)
  })

  it('coreReadyTimestamp stores the mark without a manager import', () => {
    resetCoreReadyTimestampForTests()
    markCoreReadyAtMs(1_000_000)
    assert.equal(getLastCoreReadyAtMs(), 1_000_000)
  })

  it('safeGetLastCoreReadyAtMs returns stored timestamp after mark', () => {
    resetCoreReadyTimestampForTests()
    markCoreReadyAtMs(2_000_000)
    assert.equal(safeGetLastCoreReadyAtMs(), 2_000_000)
  })
})
