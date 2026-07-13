/** Delay heavy network probes after mihomo core ready — avoids Cursor cold-start races. */

export const NETWORK_MONITOR_STARTUP_GRACE_MS = 45_000

/** Skip TUN restartCore while core is still settling (post-up + TUN route churn). */
export const TUN_RESTART_MIN_CORE_AGE_MS = 90_000

export function isCoreWithinStartupGrace(
  lastCoreReadyAtMs: number,
  graceMs: number = TUN_RESTART_MIN_CORE_AGE_MS,
  nowMs: number = Date.now()
): boolean {
  if (lastCoreReadyAtMs <= 0) {
    return true
  }
  return nowMs - lastCoreReadyAtMs < graceMs
}
