// [INPUT] cursorHy2MarathonKeepaliveCore marathon thresholds
// [OUTPUT] Connect stream keepalive timing constants + shouldRunConnectStreamKeepalive
// [POS] P8 SSOT: warm api2direct Connect transport path before ~20s read ETIMEDOUT.

import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_NUDGE_DEFER_THRESHOLD,
} from './cursorHy2MarathonKeepaliveCore'

/** Trigger Connect stream keepalive when meaningful SSE silence exceeds this (before 20s ETIMEDOUT). */
export const CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS = 15_000

/** Min interval between Connect stream keepalive probes — aligns with hung_scan 15s cadence. */
export const CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS = 12_000

/** Agent Connect SSE host (core log: api2direct.cursor.sh:443). */
export const API2DIRECT_PROBE_TARGET = 'https://api2direct.cursor.sh'

/** Agent backend Connect path (VPS sing-box @ marathon: agentn.global.api5.cursor.sh:443). */
export const CONNECT_PATH_PROBE_TARGET = 'https://agentn.global.api5.cursor.sh'

export function isConnectPathProbeDelayOk(delayMs: number): boolean {
  return Number.isFinite(delayMs) && delayMs > 0
}

/** api2/api2direct green but Connect-path probe failed — classic split-brain. */
export function detectConnectStreamPartitionStale(
  api2directDelayMs: number,
  api2DelayMs: number,
  connectPathDelayMs: number,
): boolean {
  const httpOk = api2directDelayMs > 0 || api2DelayMs > 0
  return httpOk && !isConnectPathProbeDelayOk(connectPathDelayMs)
}

export function isConnectStreamRescueEligible(
  maxGapMs: number,
  staleRequestIdCount: number,
  suddenSilentGenerationEnd = false,
): boolean {
  if (suddenSilentGenerationEnd && staleRequestIdCount > 0) {
    return true
  }
  return staleRequestIdCount > 0 && maxGapMs >= CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS
}

export interface ConnectStreamKeepaliveOptions {
  staleRequestIdCount?: number
  suddenSilentGenerationEnd?: boolean
}

export function shouldRunConnectStreamKeepalive(
  cursorConnectionCount: number,
  maxGapMs: number,
  lastKeepaliveAtMs: number,
  nowMs: number = Date.now(),
  options: ConnectStreamKeepaliveOptions = {},
): boolean {
  const connectStreamRescue = isConnectStreamRescueEligible(
    maxGapMs,
    options.staleRequestIdCount ?? 0,
    options.suddenSilentGenerationEnd ?? false,
  )
  if (
    cursorConnectionCount >= CURSOR_HY2_NUDGE_DEFER_THRESHOLD &&
    !connectStreamRescue
  ) {
    return false
  }
  if (cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  if (!connectStreamRescue && maxGapMs < CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS) {
    return false
  }
  if (lastKeepaliveAtMs <= 0) {
    return true
  }
  return nowMs - lastKeepaliveAtMs >= CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS
}
