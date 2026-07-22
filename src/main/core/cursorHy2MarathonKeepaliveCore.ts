// [INPUT] none (pure marathon timing constants)
// [OUTPUT] shouldRunHy2MarathonSessionKeepalive · shouldDeferHy2MarathonSessionNudgeForCursorLoad · hy2InQuicMarathonFields · tuicInQuicMarathonFields · QUIC SSOT
// [POS] Mac session nudge + VPS sing-box hy2-in/tuic-in 共享 marathon QUIC 计时常量。

/** HY2/TUIC marathon: keep UDP/QUIC session warm when many Cursor transport sockets are open. */

export const CURSOR_HY2_MARATHON_CONN_THRESHOLD = 12

/** Min interval between HY2 session nudges when cursor_conn ≥ threshold. */
export const CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS = 40_000

/**
 * Defer session_transport_nudge (no new api2/api2geo dial) above this cursor_conn —
 * marathon dial storms (e.g. auth refresh + token_gap nudge) amplify HY2 QUIC drops.
 */
export const CURSOR_HY2_NUDGE_DEFER_THRESHOLD = 80

/** Force nudge when active api2 probe latency exceeds this under marathon load. */
export const CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS = 600

/** Min gap between high-latency force nudges — avoids probe storms every hung_scan tick. */
export const CURSOR_HY2_HIGH_LATENCY_FORCE_MIN_INTERVAL_MS = 20_000

/** Force session nudge when Connect SSE token silence exceeds this under marathon load. */
export const CURSOR_HY2_TOKEN_GAP_FORCE_MS = 20_000

/** Min gap between token-gap force nudges. */
export const CURSOR_HY2_TOKEN_GAP_MIN_INTERVAL_MS = 15_000

/** Ignore stale activity samples older than this when scanning renderer tail. */
export const CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS = 180_000

/** Cold resume: Cursor composer warns at 32s with zero inbound tokens — nudge before 90s stall_detector. */
export const CURSOR_HY2_COLD_RESUME_NO_TOKEN_THRESHOLD_MS = 32_000

/** Lookback for cold-resume structured-log samples. */
export const CURSOR_HY2_COLD_RESUME_LOOKBACK_MS = 120_000

/** sing-box hy2-in `udp_timeout` — aligns with TUN udp-timeout 3600s (sing-box 1.13+). */
export const HY2_QUIC_IDLE_TIMEOUT = '3600s'

/** sing-box hy2-in QUIC shared fields — only written when sing-box ≥1.14 (stable 1.13.14 accepts udp_timeout only). */
export const HY2_QUIC_KEEPALIVE_PERIOD = '30s'

export const HY2_QUIC_IDLE_TIMEOUT_SEC = 3600

export const HY2_QUIC_KEEPALIVE_PERIOD_SEC = 30

/** sing-box hy2-in marathon fields (VPS patch script SSOT). */
export function hy2InQuicMarathonFields(): {
  udp_timeout: string
  idle_timeout: string
  keep_alive_period: string
} {
  return {
    udp_timeout: HY2_QUIC_IDLE_TIMEOUT,
    idle_timeout: HY2_QUIC_IDLE_TIMEOUT,
    keep_alive_period: HY2_QUIC_KEEPALIVE_PERIOD,
  }
}

export function isHy2CursorNode(nodeName: string): boolean {
  return /-HY2$/i.test(nodeName.trim())
}

/** HY2 + TUIC share the same sing-box QUIC marathon inbound tuning on Cursor VPS. */
export function isMarathonQuIcInboundCursorNode(nodeName: string): boolean {
  return /-(HY2|TUIC)$/i.test(nodeName.trim())
}

export function tuicInQuicMarathonFields(): {
  udp_timeout: string
  idle_timeout: string
  keep_alive_period: string
} {
  return hy2InQuicMarathonFields()
}

export interface Hy2SessionKeepaliveContext {
  activeNode: string
  cursorConnectionCount: number
  lastKeepaliveAtMs: number
  nowMs?: number
}

export function shouldDeferHy2MarathonSessionNudgeForCursorLoad(
  cursorConnectionCount: number,
): boolean {
  return cursorConnectionCount >= CURSOR_HY2_NUDGE_DEFER_THRESHOLD
}

export function shouldRunHy2MarathonSessionKeepalive(
  context: Hy2SessionKeepaliveContext
): boolean {
  if (!isMarathonQuIcInboundCursorNode(context.activeNode)) {
    return false
  }
  if (context.cursorConnectionCount < CURSOR_HY2_MARATHON_CONN_THRESHOLD) {
    return false
  }
  const nowMs = context.nowMs ?? Date.now()
  if (context.lastKeepaliveAtMs <= 0) {
    return true
  }
  return nowMs - context.lastKeepaliveAtMs >= CURSOR_HY2_SESSION_KEEPALIVE_INTERVAL_MS
}

export function shouldForceHy2MarathonSessionKeepaliveForHighLatency(
  cursorConnectionCount: number,
  activeProbeLatencyMs: number,
): boolean {
  return (
    cursorConnectionCount >= CURSOR_HY2_MARATHON_CONN_THRESHOLD &&
    activeProbeLatencyMs >= CURSOR_HY2_HIGH_LATENCY_FORCE_NUDGE_MS
  )
}

export function shouldForceHy2MarathonSessionKeepaliveForTokenGap(
  cursorConnectionCount: number,
  maxGapMs: number,
): boolean {
  return (
    cursorConnectionCount >= CURSOR_HY2_MARATHON_CONN_THRESHOLD &&
    maxGapMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS
  )
}

export function shouldForceHy2MarathonSessionKeepaliveForColdResume(
  cursorConnectionCount: number,
  staleColdResumeCount: number,
): boolean {
  return (
    cursorConnectionCount >= CURSOR_HY2_MARATHON_CONN_THRESHOLD &&
    staleColdResumeCount > 0
  )
}
