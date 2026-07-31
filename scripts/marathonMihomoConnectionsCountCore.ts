/** Count Cursor connections from mihomo /connections payload — SSOT for guard + soak. */

export interface MihomoConnectionRow {
  metadata?: Record<string, unknown>
}

export function countCursorConnections(connections: MihomoConnectionRow[]): number {
  let count = 0
  for (const conn of connections) {
    const metadata = conn.metadata ?? {}
    const processPath = String(metadata.processPath ?? '')
    const processName = String(metadata.process ?? '')
    if (processPath.includes('/Cursor.app/') || processPath.includes('/Cursor-3.1.15.app/')) {
      count += 1
      continue
    }
    for (const name of [
      'Cursor',
      'Cursor Helper',
      'Cursor Helper (Plugin)',
      'Cursor Helper (Renderer)',
    ]) {
      if (processName === name || processName.startsWith(`${name} `)) {
        count += 1
        break
      }
    }
  }
  return count
}
