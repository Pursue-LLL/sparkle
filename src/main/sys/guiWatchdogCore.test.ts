import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCrashLedgerLine,
  countRecentCrashRestarts,
  gracefulQuitMarkerPath,
} from './guiWatchdogCore'

describe('guiWatchdogCore', () => {
  it('graceful quit marker lives under ~/.sparkle', () => {
    assert.equal(
      gracefulQuitMarkerPath('/Users/test'),
      '/Users/test/.sparkle/gui-graceful-quit.stamp',
    )
  })

  it('counts recent crash ledger rows inside window', () => {
    const nowMs = Date.parse('2026-08-15T11:07:23.000Z')
    const lines = [
      buildCrashLedgerLine({
        ts: '2026-08-15T11:06:50.000Z',
        reason: 'unexpected_exit',
        pid: 10390,
        restart_count_window: 1,
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-14T08:00:00.000Z',
        reason: 'unexpected_exit',
        pid: 9000,
        restart_count_window: 1,
      }).trim(),
    ]
    assert.equal(countRecentCrashRestarts(lines, nowMs, 60_000), 1)
  })
})
