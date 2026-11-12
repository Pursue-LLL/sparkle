import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCrashLedgerLine,
  countRecentCrashRestarts,
  gracefulQuitMarkerPath,
  guiCrashLedgerPath,
  guiDownHandledMarkerPath,
  guiWatchdogScriptPath,
  GUI_WATCHDOG_FUSE_WINDOW_MS,
  launchAgentPlistPath,
  shouldDisableGuiAutoRelaunchOnMacOs26,
  shouldOpenFastCrashStreakFuse
} from './guiWatchdogCore'

describe('guiWatchdogCore', () => {
  it('graceful quit marker lives under ~/.sparkle', () => {
    assert.equal(
      gracefulQuitMarkerPath('/Users/test'),
      '/Users/test/.sparkle/gui-graceful-quit.stamp'
    )
  })

  it('down-handled marker lives under ~/.sparkle', () => {
    assert.equal(
      guiDownHandledMarkerPath('/Users/test'),
      '/Users/test/.sparkle/gui-watchdog-down-handled'
    )
  })

  it('keeps the ledger and the watchdog script under ~/.sparkle, the agent under LaunchAgents', () => {
    assert.equal(guiCrashLedgerPath('/Users/test'), '/Users/test/.sparkle/gui-crash-ledger.jsonl')
    assert.equal(
      guiWatchdogScriptPath('/Users/test'),
      '/Users/test/.sparkle/sparkle-gui-watchdog.sh'
    )
    assert.equal(
      launchAgentPlistPath('/Users/test'),
      '/Users/test/Library/LaunchAgents/com.sparkle.gui-watchdog.plist'
    )
  })

  it('writes one JSON object per ledger line', () => {
    const entry = {
      ts: '2026-08-15T11:06:50.000Z',
      reason: 'unexpected_exit' as const,
      pid: null,
      restart_count_window: 2
    }

    const line = buildCrashLedgerLine(entry)

    assert.equal(line.endsWith('\n'), true)
    assert.deepEqual(JSON.parse(line), entry)
  })

  it('skips blank, malformed, foreign and undated ledger rows when counting', () => {
    const nowMs = Date.parse('2026-08-15T11:07:00.000Z')
    const lines = [
      '',
      '   ',
      'not json',
      JSON.stringify({ ts: '2026-08-15T11:06:50.000Z', reason: 'graceful_quit' }),
      JSON.stringify({ reason: 'unexpected_exit' }),
      JSON.stringify({ ts: 'garbage', reason: 'unexpected_exit' }),
      JSON.stringify({ ts: '2026-08-15T11:06:50.000Z', reason: 'unexpected_exit' })
    ]

    assert.equal(countRecentCrashRestarts(lines, nowMs, 60_000), 1)
  })

  it('counts a row exactly at the window edge but not one millisecond older', () => {
    const nowMs = Date.parse('2026-08-15T11:07:00.000Z')
    const rowAt = (ms: number): string =>
      JSON.stringify({ ts: new Date(ms).toISOString(), reason: 'unexpected_exit' })

    assert.equal(countRecentCrashRestarts([rowAt(nowMs - 60_000)], nowMs, 60_000), 1)
    assert.equal(countRecentCrashRestarts([rowAt(nowMs - 60_001)], nowMs, 60_000), 0)
  })

  it('counts recent crash ledger rows inside window', () => {
    const nowMs = Date.parse('2026-08-15T11:07:23.000Z')
    const lines = [
      buildCrashLedgerLine({
        ts: '2026-08-15T11:06:50.000Z',
        reason: 'unexpected_exit',
        pid: 10390,
        restart_count_window: 1
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-14T08:00:00.000Z',
        reason: 'unexpected_exit',
        pid: 9000,
        restart_count_window: 1
      }).trim()
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
        restart_count_window: 1
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-16T02:44:40.000Z',
        reason: 'unexpected_exit',
        pid: null,
        restart_count_window: 2
      }).trim(),
      buildCrashLedgerLine({
        ts: '2026-08-16T02:45:01.000Z',
        reason: 'unexpected_exit',
        pid: null,
        restart_count_window: 3
      }).trim()
    ]
    assert.equal(countRecentCrashRestarts(lines, nowMs, 60_000), 3)
  })

  it('disables GUI auto-relaunch on macOS 26 product version', () => {
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(26), true)
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(25), false)
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(27), true)
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(Number.NaN), false)
    assert.equal(shouldDisableGuiAutoRelaunchOnMacOs26(Number.POSITIVE_INFINITY), false)
  })

  it('opens fast-crash streak fuse at limit', () => {
    assert.equal(shouldOpenFastCrashStreakFuse(2), false)
    assert.equal(shouldOpenFastCrashStreakFuse(3), true)
  })

  it('uses 5-minute fuse window constant', () => {
    assert.equal(GUI_WATCHDOG_FUSE_WINDOW_MS, 300_000)
  })
})
