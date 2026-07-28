// [INPUT] HUNG_SCAN_INTERVAL_MS from cursorTransportHealthCore
// [OUTPUT] detectConnectPartitionSignal · resolveConnectPartitionWindowMs · ConnectPartitionSignal types
// [POS] Connect split-brain partition 纯函数 SSOT；conn≥12 窗=60s（P26）· conn≥200 窗 60s（P16 ultra-conn）。

/** Connect long-stream failures while short HTTP probes stay green (split-brain). */

export const CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS = 12
export const CONNECT_PARTITION_MIN_PING_FAILURES = 2
export const CONNECT_PARTITION_WINDOW_MS = 8_000
/** P26: marathon conn cliff — sync+jsonl lag can exceed one hung_scan tick (incident: 25s). */
export const CONNECT_PARTITION_MARATHON_WINDOW_MS = 60_000
/** P16: ultra-conn sequential Diagnostic PING (23–39s timeout) needs wider window. */
export const CONNECT_PARTITION_ULTRA_CONN_THRESHOLD = 200
export const CONNECT_PARTITION_ULTRA_CONN_WINDOW_MS = 60_000

export function resolveConnectPartitionWindowMs(cursorConnectionCount: number): number {
  if (cursorConnectionCount >= CONNECT_PARTITION_ULTRA_CONN_THRESHOLD) {
    return CONNECT_PARTITION_ULTRA_CONN_WINDOW_MS
  }
  if (cursorConnectionCount >= CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS) {
    return CONNECT_PARTITION_MARATHON_WINDOW_MS
  }
  return CONNECT_PARTITION_WINDOW_MS
}

export interface AgentTransportFailureRow {
  ts?: number | string
  kind?: string
  errMsg?: string
  connectCode?: string | number
  reasonSub?: string
  reasonType?: string
  originalRequestId?: string
  requestId?: string
}

export interface ConnectPartitionSignal {
  pingFailureCount: number
  windowMs: number
  cursorConnectionCount: number
  sampleRequestIds: string[]
}

function parseFailureTs(raw: number | string | undefined): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

export function isConnectPingTransportFailure(row: AgentTransportFailureRow): boolean {
  const err = String(row.errMsg ?? '')
  const code = String(row.connectCode ?? '')
  if (/PING timed out/i.test(err)) {
    return true
  }
  if (code === '14') {
    if (/unavailable|ping/i.test(err)) {
      return true
    }
    if (/ETIMEDOUT|read ETIMEDOUT/i.test(err)) {
      return true
    }
    return row.reasonSub === 'dial-timeout' || row.reasonSub === 'read-timeout'
  }
  return false
}

/** Count Connect PING / code-14 failures in a sliding window (for split-brain when HTTP probes are green). */
export function detectConnectPartitionSignal(
  rows: readonly AgentTransportFailureRow[],
  options: {
    nowMs: number
    cursorConnectionCount: number
    windowMs?: number
    minFailures?: number
    minCursorConnections?: number
    /** P26: mass PING during conn cliff (71→0) — detect even when cursor_conn < 12. */
    allowMassPingCliffRecovery?: boolean
  },
): ConnectPartitionSignal | undefined {
  const windowMs =
    options.windowMs ?? resolveConnectPartitionWindowMs(options.cursorConnectionCount)
  const minFailures = options.minFailures ?? CONNECT_PARTITION_MIN_PING_FAILURES
  const minCursorConnections =
    options.minCursorConnections ?? CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS

  const sinceMs = options.nowMs - windowMs
  const sampleRequestIds: string[] = []
  let pingFailureCount = 0

  for (const row of rows) {
    if (!isConnectPingTransportFailure(row)) {
      continue
    }
    const ts = parseFailureTs(row.ts)
    if (ts === undefined || ts < sinceMs || ts > options.nowMs + 1_000) {
      continue
    }
    pingFailureCount += 1
    const rid = String(row.originalRequestId || row.requestId || '').trim()
    if (rid && !sampleRequestIds.includes(rid)) {
      sampleRequestIds.push(rid)
    }
  }

  if (pingFailureCount < minFailures) {
    return undefined
  }

  const connEligible =
    options.cursorConnectionCount >= minCursorConnections ||
    (options.allowMassPingCliffRecovery === true && pingFailureCount >= minFailures)
  if (!connEligible) {
    return undefined
  }

  return {
    pingFailureCount,
    windowMs,
    cursorConnectionCount: options.cursorConnectionCount,
    sampleRequestIds,
  }
}

export function shouldTreatHealthyProbeAsConnectPartition(
  probeHealthy: boolean,
  signal: ConnectPartitionSignal | undefined,
): boolean {
  return probeHealthy && signal !== undefined
}
