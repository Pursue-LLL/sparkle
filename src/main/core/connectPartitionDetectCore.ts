/** Connect long-stream failures while short HTTP probes stay green (split-brain). */

export const CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS = 12
export const CONNECT_PARTITION_MIN_PING_FAILURES = 2
export const CONNECT_PARTITION_WINDOW_MS = 8_000

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
  },
): ConnectPartitionSignal | undefined {
  const windowMs = options.windowMs ?? CONNECT_PARTITION_WINDOW_MS
  const minFailures = options.minFailures ?? CONNECT_PARTITION_MIN_PING_FAILURES
  const minCursorConnections =
    options.minCursorConnections ?? CONNECT_PARTITION_MIN_CURSOR_CONNECTIONS

  if (options.cursorConnectionCount < minCursorConnections) {
    return undefined
  }

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
