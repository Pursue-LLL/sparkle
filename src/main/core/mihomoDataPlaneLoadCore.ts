// [INPUT] mihomo active connection count
// [OUTPUT] data-plane busy gate · adaptive probe concurrency
// [POS] Phase 1S Sparkle-only load SSOT (no Cursor app coupling)

export const MIHOMO_DATA_PLANE_BUSY_CONNECTION_THRESHOLD = 48

export function isMihomoDataPlaneBusy(activeConnectionCount: number): boolean {
  if (!Number.isFinite(activeConnectionCount) || activeConnectionCount < 0) {
    return false
  }
  return activeConnectionCount >= MIHOMO_DATA_PLANE_BUSY_CONNECTION_THRESHOLD
}

export function resolveMihomoDelayProbeMaxConcurrent(activeConnectionCount: number): number {
  return isMihomoDataPlaneBusy(activeConnectionCount) ? 1 : 2
}
