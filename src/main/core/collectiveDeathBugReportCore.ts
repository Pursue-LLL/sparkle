// [INPUT] log excerpts · stability events · longevity snapshot · build metadata
// [OUTPUT] formatCollectiveDeathBugReport · filterCollectiveDeathLogLines
// [POS] BUG-2026-09-03-002 SSOT — AI-pasteable bug report for mass disconnect / byte-death.

export const COLLECTIVE_DEATH_LOG_MARKERS = [
  '[EmergencyCoreRecovery]',
  '[MihomoQuicStallRecovery]',
  '[RecoveryCoordinator]',
  '[StallEscalationLadder]',
  '[RecoveryCircuitBreaker]',
  '[MihomoQuicSilentStall]',
  '[Hy2ParentSidecar]',
  '[ByteDeathRecoveryHonesty]',
  'marathon_active_zero_data_plane_mutation',
  'byte_death',
  'EmergencyCoreRecovery',
] as const

export type CollectiveDeathTriggerKind =
  | 'emergency_core_recovery'
  | 'recovery_circuit_open'
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

export function filterCollectiveDeathLogLines(lines: readonly string[]): string[] {
  const matched = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return false
    }
    return COLLECTIVE_DEATH_LOG_MARKERS.some((marker) => trimmed.includes(marker))
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
