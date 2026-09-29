import { mihomoGetConnections } from './mihomoApi'
import {
  isCursorConnection,
  type ConnectionHygieneRow
} from './cursorConnectionHygieneCore'

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

export function startCursorConnectionHygiene(): void {
  // Pure-Pipe: hygiene timer disabled to prevent disruptive background scanning
}

export function stopCursorConnectionHygiene(): void {
  // Pure-Pipe: noop
}
