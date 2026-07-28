import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMarathonCoreRestartGuardStateFilePayload,
  formatCoreLifecycleBlockedLog,
  isMarathonCoreRestartForceOverride,
  shouldBlockMarathonCoreColdRestart,
} from './marathonCoreRestartGuardCore'

describe('marathonCoreRestartGuardCore', () => {
  it('blocks when marathon quiesce is active and cursor_conn is zero', () => {
    const decision = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: true, cursorConnectionCount: 0, updatedAtMs: 1_000 },
      false,
    )
    assert.equal(decision.blocked, true)
    assert.equal(decision.reason, 'marathon_quiesce_active')
  })

  it('blocks at marathon threshold boundary via cursor_conn_active (TIP-1)', () => {
    const decision = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: false, cursorConnectionCount: 12, updatedAtMs: 1_000 },
      false,
    )
    assert.equal(decision.blocked, true)
    assert.equal(decision.reason, 'cursor_conn_active')
  })

  it('blocks when any cursor connection is active (TIP-1 — FORCE cannot override)', () => {
    const decision = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: false, cursorConnectionCount: 4, updatedAtMs: 1_000 },
      false,
    )
    assert.equal(decision.blocked, true)
    assert.equal(decision.reason, 'cursor_conn_active')
  })

  it('allows cold restart only when cursor_conn is zero and idle', () => {
    const decision = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: false, cursorConnectionCount: 0, updatedAtMs: 1_000 },
      false,
    )
    assert.equal(decision.blocked, false)
    assert.equal(decision.reason, 'idle')
  })

  it('honors SPARKLE_FORCE_CORE_RESTART only when cursor_conn is zero', () => {
    assert.equal(isMarathonCoreRestartForceOverride('1'), true)
    const blocked = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: true, cursorConnectionCount: 20, updatedAtMs: 1_000 },
      true,
    )
    assert.equal(blocked.blocked, true)
    assert.equal(blocked.reason, 'cursor_conn_active')

    const allowed = shouldBlockMarathonCoreColdRestart(
      { quiesceActive: true, cursorConnectionCount: 0, updatedAtMs: 1_000 },
      true,
    )
    assert.equal(allowed.blocked, false)
    assert.equal(allowed.reason, 'force_override')
  })

  it('writes blockColdRestart into state file payload', () => {
    const payload = buildMarathonCoreRestartGuardStateFilePayload(
      { quiesceActive: true, cursorConnectionCount: 13, updatedAtMs: 2_000 },
      false,
    )
    assert.equal(payload.blockColdRestart, true)
    assert.equal(payload.quiesceActive, true)
    assert.equal(payload.cursorConnectionCount, 13)
    assert.equal(payload.connThreshold, 12)
  })

  it('formats blocked lifecycle log with caller and snapshot', () => {
    const snapshot = { quiesceActive: true, cursorConnectionCount: 13, updatedAtMs: 3_000 }
    const decision = shouldBlockMarathonCoreColdRestart(snapshot, false)
    const line = formatCoreLifecycleBlockedLog('install-sparkle-local', decision, snapshot)
    assert.match(line, /core_cold_restart_blocked/)
    assert.match(line, /caller=install-sparkle-local/)
    assert.match(line, /cursor_conn=13/)
  })
})
