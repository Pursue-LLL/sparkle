import { getAppConfig } from '../config'
import { appendAppLog } from '../utils/log'
import { mihomoCloseConnection, mihomoGetConnections } from './mihomoApi'
import {
  isCursorConnection,
  isIdleCursorConnection,
  mergeConnectionIdsToClose,
  selectGlobalIdleCursorConnectionsToClose,
  selectStaleCursorConnectionsToClose,
  type ConnectionHygieneRow
} from './cursorConnectionHygieneCore'

const HYGIENE_INTERVAL_MS = 10 * 60_000
const HYGIENE_START_DELAY_MS = 12 * 60_000
const HYGIENE_SKIP_LOG_COOLDOWN_MS = 10 * 60_000

let hygieneTimer: NodeJS.Timeout | null = null
let hygieneStartTimer: NodeJS.Timeout | null = null
let hygieneInFlight = false
let lastHygieneSkipLogAt = 0

function parseConnectionStartMs(start: string | undefined): number {
  if (!start) {
    return 0
  }
  const parsed = Date.parse(start)
  return Number.isFinite(parsed) ? parsed : 0
}

function toHygieneRow(connection: ControllerConnectionDetail): ConnectionHygieneRow {
  const metadata = connection.metadata ?? ({} as ControllerConnectionDetail['metadata'])
  return {
    id: connection.id,
    processPath: String(metadata.processPath ?? ''),
    process: String(metadata.process ?? ''),
    host: String(metadata.host ?? metadata.sniffHost ?? metadata.remoteDestination ?? ''),
    startMs: parseConnectionStartMs(connection.start),
    uploadSpeed: connection.uploadSpeed ?? 0,
    downloadSpeed: connection.downloadSpeed ?? 0
  }
}

export async function listCursorConnectionRows(): Promise<ConnectionHygieneRow[]> {
  const info = await mihomoGetConnections()
  const connections = info.connections ?? []
  return connections.map(toHygieneRow).filter(isCursorConnection)
}

export async function countCursorConnections(): Promise<number> {
  return (await listCursorConnectionRows()).length
}

async function runCursorConnectionHygieneCycle(): Promise<void> {
  if (hygieneInFlight) {
    return
  }

  const { cursorConnectionHygieneEnabled = true } = await getAppConfig()
  if (!cursorConnectionHygieneEnabled) {
    return
  }

  hygieneInFlight = true
  try {
    const rows = await listCursorConnectionRows()
    const staleIds = mergeConnectionIdsToClose(
      selectStaleCursorConnectionsToClose(rows),
      selectGlobalIdleCursorConnectionsToClose(rows)
    )
    if (staleIds.length === 0) {
      const nowMs = Date.now()
      if (nowMs - lastHygieneSkipLogAt >= HYGIENE_SKIP_LOG_COOLDOWN_MS) {
        lastHygieneSkipLogAt = nowMs
        const idleCount = rows.filter((row) => isIdleCursorConnection(row, nowMs)).length
        const idleRatio = rows.length > 0 ? (idleCount / rows.length).toFixed(2) : '0.00'
        await appendAppLog(
          `[CursorConnectionHygiene]: skip (cursor_conn=${rows.length}, idle_ratio=${idleRatio})\n`
        )
      }
      return
    }

    let closed = 0
    for (const id of staleIds) {
      try {
        await mihomoCloseConnection(id)
        closed += 1
      } catch {
        // ignore single close errors
      }
    }

    if (closed > 0) {
      await appendAppLog(
        `[CursorConnectionHygiene]: closed ${closed} idle Cursor connection(s); live=${rows.length - closed}\n`
      )
    }
  } catch (error) {
    await appendAppLog(
      `[CursorConnectionHygiene]: cycle failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    hygieneInFlight = false
  }
}

export function startCursorConnectionHygiene(): void {
  stopCursorConnectionHygiene()
  hygieneStartTimer = setTimeout(() => {
    hygieneStartTimer = null
    void runCursorConnectionHygieneCycle()
    hygieneTimer = setInterval(() => {
      void runCursorConnectionHygieneCycle()
    }, HYGIENE_INTERVAL_MS)
  }, HYGIENE_START_DELAY_MS)
}

export function stopCursorConnectionHygiene(): void {
  if (hygieneStartTimer) {
    clearTimeout(hygieneStartTimer)
    hygieneStartTimer = null
  }
  if (hygieneTimer) {
    clearInterval(hygieneTimer)
    hygieneTimer = null
  }
  hygieneInFlight = false
}
