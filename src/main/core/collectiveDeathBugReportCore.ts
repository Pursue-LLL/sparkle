// [INPUT] log excerpts · stability events · longevity snapshot · build metadata
// [OUTPUT] formatCollectiveDeathBugReport · filterCollectiveDeathLogLines
// [POS] BUG-2026-09-03-002 SSOT — AI-pasteable bug report for mass disconnect / byte-death.

export const COLLECTIVE_DEATH_LOG_MARKERS = [
  '[EmergencyCoreRecovery]',
  '[ProxyStackDeadlock]',
  '[MihomoQuicStallRecovery]',
  '[RecoveryCoordinator]',
  '[StallEscalationLadder]',
  '[MihomoQuicSilentStall]',
  '[Hy2ParentSidecar]',
  '[ByteDeathRecoveryHonesty]',
  'marathon_active_zero_data_plane_mutation',
  'byte_death',
  'EmergencyCoreRecovery',
] as const

export type CollectiveDeathTriggerKind =
  | 'emergency_core_recovery'
  | 'byte_death_exhausted'

export interface CollectiveDeathBugReportContext {
  trigger: CollectiveDeathTriggerKind
  tsMs: number
  sparkleSemver: string
  sparkleBuildStamp: string
  cursorConnectionCount?: number
  leafId?: string
  evidenceReason?: string
  drainMs?: number
  logLines: readonly string[]
  stabilityEventLines: readonly string[]
  longevitySnapshotJson?: string
}

/**
 * Window-aligned log filter — drops lines older than `windowMs` before `nowMs`
 * so a 09-14 toast never resurfaces 09-09 deadlock lines (iron rule #3).
 * Lines without a parseable leading ISO timestamp are kept (backward compat).
 */
export const COLLECTIVE_DEATH_LOG_WINDOW_MS = 30 * 60_000

const LEADING_ISO_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/

const APP_LOG_NAME = /^app-(\d{4})-(\d{1,2})-(\d{1,2})\.log$/

/** Calendar day key for `app-YYYY-M-D.log`; non-matching names sort oldest. */
export function parseAppLogDayKey(name: string): number {
  const match = APP_LOG_NAME.exec(name.trim())
  if (!match) {
    return Number.NEGATIVE_INFINITY
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return Number.NEGATIVE_INFINITY
  }
  return Date.UTC(year, month - 1, day)
}

/**
 * Orders `app-*.log` names newest-first by calendar day.
 * Lexicographic sort is WRONG here: 'app-2026-9-9.log' > 'app-2026-9-15.log'
 * because '9' > '1', so the collector kept reading a 6-day-old file — the root
 * cause of stale report lines (false 09-09 evidence on 09-14 toasts).
 */
export function orderAppLogNamesNewestFirst(names: readonly string[]): string[] {
  return names
    .filter((name) => APP_LOG_NAME.test(name.trim()))
    .map((name) => ({ name, key: parseAppLogDayKey(name) }))
    .sort((left, right) => right.key - left.key || right.name.localeCompare(left.name))
    .map((entry) => entry.name)
}

export function filterCollectiveDeathLogLines(
  lines: readonly string[],
  nowMs?: number,
  windowMs: number = COLLECTIVE_DEATH_LOG_WINDOW_MS,
): string[] {
  const matched = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return false
    }
    if (!COLLECTIVE_DEATH_LOG_MARKERS.some((marker) => trimmed.includes(marker))) {
      return false
    }
    if (nowMs == null) {
      return true
    }
    const tsMatch = LEADING_ISO_TS.exec(trimmed)
    if (!tsMatch) {
      return true
    }
    const lineMs = Date.parse(tsMatch[1] ?? '')
    if (!Number.isFinite(lineMs)) {
      return true
    }
    return nowMs - lineMs <= windowMs
  })
  return matched.slice(-40)
}

export function formatCollectiveDeathBugReport(input: CollectiveDeathBugReportContext): string {
  const iso = new Date(input.tsMs).toISOString()
  const sections: string[] = [
    '# Sparkle Collective Death Bug Report',
    '',
    '## Environment',
    `- reported_at: ${iso}`,
    `- sparkle_version: ${input.sparkleSemver}`,
    `- build_stamp: ${input.sparkleBuildStamp}`,
    `- trigger: ${input.trigger}`,
  ]
  if (input.cursorConnectionCount != null) {
    sections.push(`- cursor_conn: ${input.cursorConnectionCount}`)
  }
  if (input.leafId) {
    sections.push(`- leaf: ${input.leafId}`)
  }
  if (input.evidenceReason) {
    sections.push(`- evidence: ${input.evidenceReason}`)
  }
  if (input.drainMs != null && input.drainMs > 0) {
    sections.push(`- emergency_drain_ms: ${input.drainMs}`)
  }
  sections.push('', '## Recent diagnostic log lines (filtered)', ...input.logLines.map((l) => l.trim()))
  if (input.stabilityEventLines.length > 0) {
    sections.push('', '## network-stability-events.jsonl (tail)', ...input.stabilityEventLines)
  }
  if (input.longevitySnapshotJson) {
    sections.push('', '## transport-longevity-truth.json', '```json', input.longevitySnapshotJson, '```')
  }
  sections.push(
    '',
    '## Instructions for AI',
    'Analyze root cause from log lines above. Do not assume GUI quit stopped proxy is a bug.',
    'Check marathon tier0 SEL path vs EmergencyCoreRecovery escalation.',
  )
  return sections.join('\n')
}
