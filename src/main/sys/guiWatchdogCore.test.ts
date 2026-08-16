import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCrashLedgerLine,
  countRecentCrashRestarts,
  gracefulQuitMarkerPath,
  guiDownHandledMarkerPath,
  GUI_WATCHDOG_FUSE_WINDOW_MS,
  shouldDisableGuiAutoRelaunchOnMacOs26,
  shouldOpenFastCrashStreakFuse,
} from './guiWatchdogCore'

describe('guiWatchdogCore', () => {
  it('graceful quit marker lives under ~/.sparkle', () => {
    assert.equal(
      gracefulQuitMarkerPath('/Users/test'),
      '/Users/test/.sparkle/gui-graceful-quit.stamp',
    )
  })

  it('down-handled marker lives under ~/.sparkle', () => {
    assert.equal(
      guiDownHandledMarkerPath('/Users/test'),
      '/Users/test/.sparkle/gui-watchdog-down-handled',
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

  it('opens fuse when three unexpected exits land inside window', () => {
    const nowMs = Date.parse('2026-08-16T02:45:01.000Z')
    const lines = [
      buildCrashLedgerLine({
        ts: '2026-08-16T02:44:20.000Z',
        reason: 'unexpected_exit',
        pid: null,
        restart_count_window: 1,
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-16T02:44:40.000Z',
        reason: 'unexpected_exit',
        pid: null,
        restart_count_window: 2,
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-16T02:45:01.000Z',
        reason: 'unexpected_exit',
        pid: null,
        restart_count_window: 3,
      }).trim(),
    ]
    assert.equal(countRecentCrashRestarts(lines, nowMs, 60_000), 3)
  })

  it('disables GUI auto-relaunch on macOS 26 product version', () => {
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(26), true)
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(25), false)
  })

  it('opens fast-crash streak fuse at limit', () => {
    assert.equal(shouldOpenFastCrashStreakFuse(2), false)
    assert.equal(shouldOpenFastCrashStreakFuse(3), true)
  })

  it('uses 5-minute fuse window constant', () => {
    assert.equal(GUI_WATCHDOG_FUSE_WINDOW_MS, 300_000)
  })
})
