import { CURSOR_PROCESS_NAMES } from './cursorRuleInjection'

/** Defer api2 probes while Cursor has many live mihomo sockets (marathon). */
export const CURSOR_CONN_PROBE_DEFER_THRESHOLD = 20

/** Keep at least this many newest Cursor sockets during global idle prune. */
export const CURSOR_CONN_GLOBAL_KEEP_NEWEST = 12

/** Start global idle prune when total Cursor sockets reach this count. */
export const CURSOR_CONN_GLOBAL_PRUNE_THRESHOLD = 20

/** Require at least this share of sockets to be idle before global prune. */
export const CURSOR_CONN_GLOBAL_IDLE_RATIO_MIN = 0.5

/** Start hygiene only after this many Cursor-related connections. */
export const CURSOR_CONN_HYGIENE_MIN_COUNT = 12

/** Close only connections older than this with zero speed. */
export const CURSOR_CONN_IDLE_MIN_AGE_MS = 35 * 60_000

/** Keep up to N newest sockets per (processPath, host); close older idle extras. */
export const CURSOR_CONN_DUPLICATE_PER_HOST_MAX = 4

export interface ConnectionHygieneRow {
  id: string
  processPath: string
  process: string
  host: string
  startMs: number
  uploadSpeed: number
  downloadSpeed: number
}

function isCursorProcessPath(processPath: string): boolean {
  const path = processPath.trim()
  return path.includes('/Cursor.app/') || path.includes('/Cursor-3.1.15.app/')
}

function isCursorProcessName(process: string): boolean {
  const proc = process.trim()
  if (!proc) {
    return false
  }
  return CURSOR_PROCESS_NAMES.some((name) => proc === name || proc.startsWith(`${name} `))
}

export function isCursorConnection(row: ConnectionHygieneRow): boolean {
  if (isCursorProcessPath(row.processPath)) {
    return true
  }
  return isCursorProcessName(row.process)
}

export function isIdleCursorConnection(row: ConnectionHygieneRow, nowMs: number): boolean {
  if (nowMs - row.startMs < CURSOR_CONN_IDLE_MIN_AGE_MS) {
    return false
  }
  return row.uploadSpeed <= 0 && row.downloadSpeed <= 0
}

export function selectStaleCursorConnectionsToClose(
  rows: ConnectionHygieneRow[],
  nowMs: number = Date.now()
): string[] {
  const cursorRows = rows.filter(isCursorConnection)
  if (cursorRows.length < CURSOR_CONN_HYGIENE_MIN_COUNT) {
    return []
  }

  const toClose = new Set<string>()
  const byKey = new Map<string, ConnectionHygieneRow[]>()

  for (const row of cursorRows) {
    const host = row.host.trim() || 'unknown'
    const key = `${row.processPath.trim() || row.process.trim()}::${host}`
    const bucket = byKey.get(key) ?? []
    bucket.push(row)
    byKey.set(key, bucket)
  }

  for (const bucket of byKey.values()) {
    const sorted = [...bucket].sort((a, b) => b.startMs - a.startMs)
    for (let index = CURSOR_CONN_DUPLICATE_PER_HOST_MAX; index < sorted.length; index += 1) {
      const row = sorted[index]
      if (isIdleCursorConnection(row, nowMs)) {
        toClose.add(row.id)
      }
    }
  }

  return [...toClose]
}

export function shouldDeferNetworkProbeForCursorLoad(cursorConnectionCount: number): boolean {
  return cursorConnectionCount >= CURSOR_CONN_PROBE_DEFER_THRESHOLD
}

export function mergeConnectionIdsToClose(
  duplicateIds: string[],
  globalIds: string[]
): string[] {
  return [...new Set([...duplicateIds, ...globalIds])]
}

export function selectGlobalIdleCursorConnectionsToClose(
  rows: ConnectionHygieneRow[],
  nowMs: number = Date.now()
): string[] {
  const cursorRows = rows.filter(isCursorConnection)
  if (cursorRows.length < CURSOR_CONN_GLOBAL_PRUNE_THRESHOLD) {
    return []
  }

  const idleRows = cursorRows.filter((row) => isIdleCursorConnection(row, nowMs))
  if (idleRows.length / cursorRows.length < CURSOR_CONN_GLOBAL_IDLE_RATIO_MIN) {
    return []
  }

  const keepIds = new Set(
    [...cursorRows]
      .sort((a, b) => b.startMs - a.startMs)
      .slice(0, CURSOR_CONN_GLOBAL_KEEP_NEWEST)
      .map((row) => row.id)
  )

  return idleRows.filter((row) => !keepIds.has(row.id)).map((row) => row.id)
}
