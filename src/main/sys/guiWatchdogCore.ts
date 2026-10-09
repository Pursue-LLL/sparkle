import path from 'path'

export const GUI_WATCHDOG_LAUNCH_AGENT_LABEL = 'com.sparkle.gui-watchdog'
export const GUI_WATCHDOG_FUSE_WINDOW_MS = 300_000
export const GUI_WATCHDOG_MAX_RESTARTS = 3
export const GUI_WATCHDOG_FAST_CRASH_STREAK_LIMIT = 3

export interface GuiCrashLedgerEntry {
  ts: string
  reason: 'unexpected_exit'
  pid: number | null
  restart_count_window: number
}

function sparkleStateDir(homeDir: string): string {
  return path.join(homeDir, '.sparkle')
}

export function gracefulQuitMarkerPath(homeDir: string): string {
  return path.join(sparkleStateDir(homeDir), 'gui-graceful-quit.stamp')
}

export function guiCrashLedgerPath(homeDir: string): string {
  return path.join(sparkleStateDir(homeDir), 'gui-crash-ledger.jsonl')
}

export function guiWatchdogScriptPath(homeDir: string): string {
  return path.join(sparkleStateDir(homeDir), 'sparkle-gui-watchdog.sh')
}

export function guiDownHandledMarkerPath(homeDir: string): string {
  return path.join(sparkleStateDir(homeDir), 'gui-watchdog-down-handled')
}

export function launchAgentPlistPath(homeDir: string): string {
  return path.join(homeDir, 'Library', 'LaunchAgents', `${GUI_WATCHDOG_LAUNCH_AGENT_LABEL}.plist`)
}

export function buildCrashLedgerLine(entry: GuiCrashLedgerEntry): string {
  return `${JSON.stringify(entry)}\n`
}

export function shouldDisableGuiAutoRelaunchOnMacOs26(productVersionMajor: number): boolean {
  return Number.isFinite(productVersionMajor) && productVersionMajor >= 26
}

export function shouldOpenFastCrashStreakFuse(streak: number): boolean {
  return streak >= GUI_WATCHDOG_FAST_CRASH_STREAK_LIMIT
}

export function countRecentCrashRestarts(
  lines: string[],
  nowMs: number,
  windowMs: number,
): number {
  const cutoff = nowMs - windowMs
  let count = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as { ts?: string; reason?: string }
      if (parsed.reason !== 'unexpected_exit' || !parsed.ts) continue
      const tsMs = Date.parse(parsed.ts)
      if (!Number.isNaN(tsMs) && tsMs >= cutoff) {
        count += 1
      }
    } catch {
      // ignore malformed ledger rows
    }
  }
  return count
}
