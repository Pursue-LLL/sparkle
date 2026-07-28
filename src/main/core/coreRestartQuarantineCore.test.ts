import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPostCoreRestartQuarantineActive,
  POST_CORE_RESTART_QUARANTINE_MS,
  remainingPostCoreRestartQuarantineMs,
  shouldDeferObservabilityDialDuringPostCoreRestartQuarantine,
} from './coreRestartQuarantineCore'

describe('coreRestartQuarantineCore', () => {
  it('quarantine active within 10min after core ready', () => {
    const readyAt = 1_000_000
    assert.equal(
      isPostCoreRestartQuarantineActive(readyAt, readyAt + POST_CORE_RESTART_QUARANTINE_MS - 1),
      true,
    )
    assert.equal(
      isPostCoreRestartQuarantineActive(readyAt, readyAt + POST_CORE_RESTART_QUARANTINE_MS),
      false,
    )
  })

  it('remaining ms decreases toward zero', () => {
    const readyAt = 2_000_000
    const nowMs = readyAt + 60_000
    assert.equal(remainingPostCoreRestartQuarantineMs(readyAt, nowMs), POST_CORE_RESTART_QUARANTINE_MS - 60_000)
    assert.equal(remainingPostCoreRestartQuarantineMs(readyAt, readyAt + POST_CORE_RESTART_QUARANTINE_MS), 0)
  })

  it('defers marketplace and regional warmup dial kinds during quarantine', () => {
    const readyAt = 3_000_000
    const nowMs = readyAt + 60_000
    assert.equal(
      shouldDeferObservabilityDialDuringPostCoreRestartQuarantine(
        'marketplace_probe',
        readyAt,
        nowMs,
      ),
      true,
    )
    assert.equal(
      shouldDeferObservabilityDialDuringPostCoreRestartQuarantine(
        'managed_ui_delay_test',
        readyAt,
        nowMs,
      ),
      false,
    )
  })
})
