// [INPUT] none (pure marathon timing constants)
// [OUTPUT] MarathonWarmthTrigger · shouldDeferMarathonWarmth · MarathonSessionKeepaliveResult · formatMarathonRescueNudgeLogLine · shouldRunHy2MarathonSessionKeepalive · hy2InQuicMarathonFields · QUIC SSOT
// [POS] MTCP SSOT: Rescue vs Warmth defer policy + Mac session nudge + VPS sing-box hy2-in/tuic-in QUIC 常量。

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

/**
 * Marathon token-gap scan window — must cover long tool pauses (incident f4344246: ~546s gap).
 * Aligns with P22 segment handoff (~90min) so growing gaps are not dropped from detection.
 */
export const CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS = 5_400_000

/** Pending-tool SSE silence below this gap is expected; above it still nudge HY2 keepalive. */
export const CURSOR_HY2_PENDING_TOOL_GAP_SUPPRESS_MAX_MS = 60_000

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

/** MTCP session nudge triggers — replaces force/tokenGapForce/highLatencyForce boolean soup. */
export type MarathonWarmthTrigger =
  | 'connect_partition'
  | 'latency_delta_rescue'
  | 'silent_generation_end'
  | 'connect_path_partition'
  | 'token_gap'
  | 'cold_resume'
  | 'marathon_connect_path_pulse'
  | 'periodic_session'
  | 'high_latency_warmth'

const MARATHON_RESCUE_TRIGGERS: ReadonlySet<MarathonWarmthTrigger> = new Set([
  'connect_partition',
  'latency_delta_rescue',
  'silent_generation_end',
  'connect_path_partition',
  'token_gap',
  'cold_resume',
])

export interface MarathonWarmthDeferContext {
  maxGapMs?: number
  staleRequestIdCount?: number
}

export function isMarathonRescueTrigger(trigger: MarathonWarmthTrigger): boolean {
  return MARATHON_RESCUE_TRIGGERS.has(trigger)
}

export function isTokenGapRescueEligible(
  maxGapMs: number,
  staleRequestIdCount: number,
): boolean {
  return staleRequestIdCount > 0 && maxGapMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS
}

export function shouldDeferMarathonWarmth(
  cursorConnectionCount: number,
  trigger: MarathonWarmthTrigger,
  context: MarathonWarmthDeferContext = {},
): boolean {
  if (cursorConnectionCount < CURSOR_HY2_NUDGE_DEFER_THRESHOLD) {
    return false
  }
  switch (trigger) {
    case 'connect_partition':
    case 'latency_delta_rescue':
    case 'silent_generation_end':
    case 'connect_path_partition':
    case 'marathon_connect_path_pulse':
      return false
    case 'token_gap':
      return !isTokenGapRescueEligible(
        context.maxGapMs ?? 0,
        context.staleRequestIdCount ?? 0,
      )
    case 'cold_resume':
      return (context.staleRequestIdCount ?? 0) <= 0
    case 'periodic_session':
    case 'high_latency_warmth':
      return true
  }
}

export function resolveMarathonWarmthLogKind(trigger: MarathonWarmthTrigger): string {
  switch (trigger) {
    case 'connect_partition':
      return 'connect_partition_rescue_nudge'
    case 'latency_delta_rescue':
      return 'latency_delta_rescue_nudge'
    case 'silent_generation_end':
      return 'silent_generation_end_rescue_nudge'
    case 'connect_path_partition':
      return 'connect_path_partition_rescue_nudge'
    case 'marathon_connect_path_pulse':
      return 'marathon_connect_path_pulse'
    case 'token_gap':
      return 'token_gap_rescue_nudge'
    case 'cold_resume':
      return 'cold_resume_rescue_nudge'
    case 'high_latency_warmth':
      return 'high_latency_force_nudge'
    case 'periodic_session':
      return 'session_transport_nudge'
  }
}

/** P12: single-line triage SSOT for rescue nudge attempts. */
export type MarathonSessionKeepaliveOutcome =
  | 'executed'
  | 'skipped_in_flight'
  | 'skipped_no_quic_node'
  | 'skipped_not_due'
  | 'skipped_cooldown'
  | 'skipped_deferred'
  | 'skipped_connect_keepalive_in_flight'
  | 'skipped_budget_busy'
  | 'skipped_weak_probe'
  | 'failed'

/** P27/R-B: triage SSOT — distinguish post-mortem rescue from live-path warmth. */
export type MarathonRescueDialLogOutcome =
  | MarathonSessionKeepaliveOutcome
  | 'attempted_on_stale_rid'
  | 'executed_on_stale_rid'
  | 'executed_on_live_rid'

export function resolveRescueDialLogOutcome(
  trigger: MarathonWarmthTrigger,
  result: MarathonSessionKeepaliveResult,
  fields: { maxGapMs?: number; staleRequestIdCount?: number; staleRids?: string },
): MarathonRescueDialLogOutcome {
  if (result.outcome !== 'executed') {
    return result.outcome
  }
  const staleCount =
    fields.staleRequestIdCount ??
    (fields.staleRids ? fields.staleRids.split(',').filter((id) => id.trim().length > 0).length : 0)
  if (
    (trigger === 'token_gap' ||
      trigger === 'silent_generation_end' ||
      trigger === 'cold_resume') &&
    staleCount > 0 &&
    (fields.maxGapMs ?? 0) >= CURSOR_HY2_TOKEN_GAP_FORCE_MS
  ) {
    return 'attempted_on_stale_rid'
  }
  if (trigger === 'periodic_session' || trigger === 'high_latency_warmth') {
    return 'executed_on_live_rid'
  }
  return 'executed'
}

export interface MarathonSessionKeepaliveResult {
  outcome: MarathonSessionKeepaliveOutcome
  err?: string
  api2DelayMs?: number
  api2geoDelayMs?: number
}

export function formatMarathonRescueNudgeLogLine(
  trigger: MarathonWarmthTrigger,
  result: MarathonSessionKeepaliveResult,
  fields: {
    cursorConnectionCount: number
    maxGapMs?: number
    staleRids?: string
    staleRequestIdCount?: number
    partitionLatchAgeMs?: number
  },
): string {
  const logOutcome = resolveRescueDialLogOutcome(trigger, result, fields)
  const parts = [
    `[CursorHy2MarathonKeepalive]: ${trigger}_nudge`,
    `outcome=${logOutcome}`,
    `cursor_conn=${fields.cursorConnectionCount}`,
  ]
  if (fields.partitionLatchAgeMs != null && fields.partitionLatchAgeMs >= 0) {
    parts.push(`partition_latch_age_ms=${fields.partitionLatchAgeMs}`)
  }
  if (fields.maxGapMs != null) {
    parts.push(`max_gap_ms=${fields.maxGapMs}`)
  }
  if (fields.staleRids) {
    parts.push(`stale_rids=${fields.staleRids}`)
  }
  if (result.api2DelayMs != null) {
    parts.push(`api2_delay_ms=${result.api2DelayMs}`)
  }
  if (result.api2geoDelayMs != null) {
    parts.push(`api2geo_delay_ms=${result.api2geoDelayMs}`)
  }
  if (result.err) {
    parts.push(`err=${result.err}`)
  }
  return `${parts.join(' ')}\n`
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
