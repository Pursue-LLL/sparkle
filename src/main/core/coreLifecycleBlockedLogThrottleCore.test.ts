import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  planCoreLifecycleBlockedLog,
  resetCoreLifecycleBlockedLogThrottleForTests,
} from './coreLifecycleBlockedLogThrottleCore'

describe('coreLifecycleBlockedLogThrottleCore', () => {
  it('suppresses repeated blocked logs within 5 minutes', () => {
    resetCoreLifecycleBlockedLogThrottleForTests()
    const line = '[CoreLifecycle]: core_cold_restart_blocked caller=profile-update-cli reason=cursor_conn_active\n'
    const first = planCoreLifecycleBlockedLog({
      caller: 'profile-update-cli',
      reason: 'cursor_conn_active',
      nowMs: 1_000,
      formattedLine: line,
    })
    const second = planCoreLifecycleBlockedLog({
      caller: 'profile-update-cli',
      reason: 'cursor_conn_active',
      nowMs: 60_000,
      formattedLine: line,
    })
    assert.equal(first.emit, true)
    assert.equal(second.emit, false)
  })

  it('emits summary after suppression window', () => {
    resetCoreLifecycleBlockedLogThrottleForTests()
    const line = '[CoreLifecycle]: core_cold_restart_blocked caller=profile-update-cli reason=cursor_conn_active\n'
    planCoreLifecycleBlockedLog({
      caller: 'profile-update-cli',
      reason: 'cursor_conn_active',
      nowMs: 1_000,
      formattedLine: line,
    })
    planCoreLifecycleBlockedLog({
      caller: 'profile-update-cli',
      reason: 'cursor_conn_active',
      nowMs: 60_000,
      formattedLine: line,
    })
    const third = planCoreLifecycleBlockedLog({
      caller: 'profile-update-cli',
      reason: 'cursor_conn_active',
      nowMs: 301_000,
      formattedLine: line,
    })
    assert.equal(third.emit, true)
    assert.match(third.line, /suppressed_repeats=1/)
  })
})
