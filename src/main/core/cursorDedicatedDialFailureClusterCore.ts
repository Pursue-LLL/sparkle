// [INPUT] mihomo core log lines (Cursor dedicated dial failures)
// [OUTPUT] classify · sliding-window cluster detection
// [POS] BUG-2026-09-03-005 — silent collective disconnect when stall=0 but dial errors spike.

/** Minimum Cursor专用 dial failures in window to treat as collective disconnect. */
export const CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT = 5

/** Rolling window for dial-failure cluster detection. */
export const CURSOR_DIAL_FAILURE_CLUSTER_WINDOW_MS = 10_000

/** Cooldown between cluster-triggered recovery dispatches. */
export const CURSOR_DIAL_FAILURE_CLUSTER_RECOVERY_COOLDOWN_MS = 60_000

export type CursorDedicatedDialFailureKind =
  | 'context_deadline_exceeded'
  | 'tcp_io_timeout'
  | 'other'

export interface CursorDedicatedDialFailureEvent {
  tsMs: number
  kind: CursorDedicatedDialFailureKind
  line: string
}

export function classifyCursorDedicatedDialFailureLine(
  line: string,
): CursorDedicatedDialFailureEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed.includes('dial 🎯 Cursor 专用') || !trimmed.includes('error:')) {
    return undefined
  }
  const tsMatch = trimmed.match(/^time="([^"]+)"/)
  const tsMs = tsMatch ? Date.parse(tsMatch[1]!) : NaN
  if (!Number.isFinite(tsMs)) {
    return undefined
  }
  if (/error: context deadline exceeded/.test(trimmed)) {
    return { tsMs, kind: 'context_deadline_exceeded', line: trimmed }
  }
  if (/dial tcp [\d.]+:\d+: i\/o timeout/.test(trimmed)) {
    return { tsMs, kind: 'tcp_io_timeout', line: trimmed }
  }
  if (/connect error:.*i\/o timeout/.test(trimmed)) {
    return { tsMs, kind: 'tcp_io_timeout', line: trimmed }
  }
  return { tsMs, kind: 'other', line: trimmed }
}

export function pruneCursorDedicatedDialFailureEvents(
  events: readonly CursorDedicatedDialFailureEvent[],
  nowMs: number,
  windowMs: number = CURSOR_DIAL_FAILURE_CLUSTER_WINDOW_MS,
): CursorDedicatedDialFailureEvent[] {
  const cutoff = nowMs - windowMs
  return events.filter((event) => event.tsMs >= cutoff)
}

export function isCursorDedicatedDialFailureCluster(input: {
  events: readonly CursorDedicatedDialFailureEvent[]
  minCount?: number
}): boolean {
  const min = input.minCount ?? CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT
  return input.events.length >= min
}

/** Evidence for emergency core restart when dial cluster fires but mihomo omits HY2 UDP parent row. */
export const DIAL_FAILURE_CLUSTER_UDP_ABSENT_REQUIRES_CORE_RESTART =
  'cursor_dedicated_dial_failure_cluster_udp_absent'

/**
 * BUG-2026-09-03-008: dial cluster proves Cursor dedicated path is dead.
 * Force parent UDP refresh — do NOT trust connect_path vitality (false positive on stale HY2).
 */
export function shouldForceParentUdpRefreshOnDialCluster(input: {
  clusterSize: number
  activeLeaf: string
}): { force: boolean; reason: string } {
  if (!input.activeLeaf.trim()) {
    return { force: false, reason: 'missing_active_leaf' }
  }
  if (input.clusterSize < CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT) {
    return { force: false, reason: 'cluster_below_threshold' }
  }
  return { force: true, reason: 'dial_failure_cluster_force_udp_refresh' }
}

/** @deprecated Use shouldForceParentUdpRefreshOnDialCluster — kept for test compat alias */
export function shouldForceParentUdpRefreshOnVitalityFailure(input: {
  vitalityFailed: boolean
  clusterSize: number
  activeLeaf: string
}): { force: boolean; reason: string } {
  if (!input.vitalityFailed) {
    return { force: false, reason: 'vitality_not_failed' }
  }
  return shouldForceParentUdpRefreshOnDialCluster(input)
}
