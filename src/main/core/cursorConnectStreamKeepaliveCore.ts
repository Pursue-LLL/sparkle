// [INPUT] cursorHy2MarathonKeepaliveCore marathon thresholds
// [OUTPUT] Connect stream keepalive timing constants + shouldRunConnectStreamKeepalive
// [POS] P8 SSOT: warm api2direct Connect transport path before ~20s read ETIMEDOUT.

import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'

/** Trigger Connect stream keepalive when meaningful SSE silence exceeds this (before 20s ETIMEDOUT). */
export const CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS = 15_000

/** Min interval between Connect stream keepalive probes — aligns with hung_scan 15s cadence. */
export const CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS = 12_000

/** Agent Connect SSE host (core log: api2direct.cursor.sh:443). */
export const API2DIRECT_PROBE_TARGET = 'https://api2direct.cursor.sh'

export function shouldRunConnectStreamKeepalive(
  cursorConnectionCount: number,
  maxGapMs: number,
  lastKeepaliveAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  if (maxGapMs < CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS) {
    return false
  }
  if (lastKeepaliveAtMs <= 0) {
    return true
  }
  return nowMs - lastKeepaliveAtMs >= CURSOR_CONNECT_STREAM_KEEPALIVE_MIN_INTERVAL_MS
}
