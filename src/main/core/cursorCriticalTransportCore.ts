/** Cursor Agent / Chat transport hosts — hung detection + hygiene protection scope. */
export const CRITICAL_CURSOR_HOST_SUFFIXES = [
  'api2.cursor.sh',
  'api2geo.cursor.sh',
  'api2direct.cursor.sh',
  'api3.cursor.sh',
  'api5.cursor.sh',
  'agent.api5.cursor.sh',
  'agentn.global.api5.cursor.sh',
  'agentn.global.api5lat.cursor.sh'
] as const

function normalizeHost(host: string): string {
  return host.trim().toLowerCase()
}

export function isCriticalCursorHost(host: string): boolean {
  const normalized = normalizeHost(host)
  if (!normalized || normalized === 'unknown') {
    return false
  }
  if (CRITICAL_CURSOR_HOST_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))) {
    return true
  }
  return normalized.endsWith('.cursor.sh') || normalized.endsWith('.cursor.com')
}
