import {
  CURSOR_CONN_IDLE_MIN_AGE_MS,
  isCursorConnection,
  type ConnectionHygieneRow
} from './cursorConnectionHygieneCore'

/** Cursor Agent / Chat transport hosts — hung detection scope. */
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

export const HUNG_CONNECTION_MIN_AGE_MS = 12 * 60_000
export const HUNG_SCAN_INTERVAL_MS = 30_000
export const MANDATORY_REAL_PROBE_MAX_AGE_MS = 30_000

/** Never L0-close the N newest zero-throughput sockets per process+host (active Agent Connect streams). */
export const HUNG_CONNECTION_KEEP_NEWEST_PER_HOST = 6

export const RECOVERY_L0_COOLDOWN_MS = 30_000
export const RECOVERY_L1_COOLDOWN_MS = 60_000
export const RECOVERY_L2_COOLDOWN_MS = 120_000
export const RECOVERY_L3_COOLDOWN_MS = 10 * 60_000

export const SPLIT_BRAIN_CONTROL_HOST = 'marketplace.cursorapi.com'
export const API2_PROBE_TARGET = 'https://api2.cursor.sh'
export const SPLIT_BRAIN_CONTROL_TARGET = `https://${SPLIT_BRAIN_CONTROL_HOST}`

export type ProbeAttribution =
  | 'healthy'
  | 'node_degraded'
  | 'transport_partition_stale'
  | 'deferred_load'
  | 'offline'
  | 'ssh_target_unresolved'
  | 'fake_ip_misroute'

export type RecoveryLevel = 'L0' | 'L1' | 'L2' | 'L3'

export type RecoveryAction = RecoveryLevel | 'none'

export interface ProbePairResult {
  api2Ok: boolean
  marketplaceOk: boolean
  api2LatencyMs: number
  marketplaceLatencyMs: number
}

export interface MandatoryProbeContext {
  cursorConnectionCount: number
  lastRealProbeAtMs: number
  hungConnectionCount: number
  tunInterfaceLostLatched: boolean
  burstProbeActive: boolean
  nowMs?: number
}

export interface RecoveryCooldownState {
  lastL0AtMs: number
  lastL1AtMs: number
  lastL2AtMs: number
  lastL3AtMs: number
}

export interface RecoveryDecisionContext {
  probe: ProbePairResult
  attribution: ProbeAttribution
  hungConnectionIds: string[]
  tunInterfaceLostConfirmed: boolean
  priorRecoveryFailed: boolean
  cooldowns: RecoveryCooldownState
  nowMs?: number
}

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

export function isHungCursorConnection(row: ConnectionHygieneRow, nowMs: number = Date.now()): boolean {
  if (!isCursorConnection(row)) {
    return false
  }
  if (!isCriticalCursorHost(row.host)) {
    return false
  }
  if (nowMs - row.startMs < HUNG_CONNECTION_MIN_AGE_MS) {
    return false
  }
  return row.uploadSpeed <= 0 && row.downloadSpeed <= 0
}

export function selectHungCursorConnectionsToClose(
  rows: ConnectionHygieneRow[],
  nowMs: number = Date.now()
): string[] {
  const hungRows = rows.filter((row) => isHungCursorConnection(row, nowMs))
  if (hungRows.length === 0) {
    return []
  }

  const protectedIds = new Set<string>()
  const byKey = new Map<string, ConnectionHygieneRow[]>()

  for (const row of hungRows) {
    const host = row.host.trim() || 'unknown'
    const proc = row.processPath.trim() || row.process.trim()
    const key = `${proc}::${host}`
    const bucket = byKey.get(key) ?? []
    bucket.push(row)
    byKey.set(key, bucket)
  }

  for (const bucket of byKey.values()) {
    const sorted = [...bucket].sort((a, b) => b.startMs - a.startMs)
    const keepCount = Math.min(HUNG_CONNECTION_KEEP_NEWEST_PER_HOST, sorted.length)
    for (let index = 0; index < keepCount; index += 1) {
      protectedIds.add(sorted[index].id)
    }
  }

  return hungRows.filter((row) => !protectedIds.has(row.id)).map((row) => row.id)
}

export function selectCriticalHostConnectionsToClose(
  rows: ConnectionHygieneRow[]
): string[] {
  return rows
    .filter((row) => isCursorConnection(row) && isCriticalCursorHost(row.host))
    .map((row) => row.id)
}

export function shouldForceMandatoryRealProbe(context: MandatoryProbeContext): boolean {
  const nowMs = context.nowMs ?? Date.now()
  if (context.tunInterfaceLostLatched) {
    return true
  }
  if (context.burstProbeActive) {
    return true
  }
  if (context.hungConnectionCount > 0) {
    return true
  }
  if (context.lastRealProbeAtMs <= 0) {
    return true
  }
  return nowMs - context.lastRealProbeAtMs >= MANDATORY_REAL_PROBE_MAX_AGE_MS
}

export function shouldDeferProbeForCursorLoad(
  cursorConnectionCount: number,
  context: MandatoryProbeContext
): boolean {
  if (cursorConnectionCount < 20) {
    return false
  }
  return !shouldForceMandatoryRealProbe(context)
}

export function resolveProbeAttribution(probe: ProbePairResult): ProbeAttribution {
  if (!probe.api2Ok && !probe.marketplaceOk) {
    return 'offline'
  }
  if (!probe.api2Ok && probe.marketplaceOk) {
    return 'transport_partition_stale'
  }
  if (!probe.api2Ok) {
    return 'node_degraded'
  }
  return 'healthy'
}

export function shouldExcludeProbeSampleFromNodeScoring(attribution: ProbeAttribution): boolean {
  return (
    attribution === 'transport_partition_stale' ||
    attribution === 'deferred_load' ||
    attribution === 'offline' ||
    attribution === 'ssh_target_unresolved' ||
    attribution === 'fake_ip_misroute'
  )
}

export function shouldDeferDestructiveRecoveryAfterLiveProbe(
  liveProbeOk: boolean,
  currentProxy: string,
  liveProbeProxyNode?: string
): boolean {
  if (!liveProbeOk) {
    return false
  }
  if (!liveProbeProxyNode) {
    return true
  }
  return liveProbeProxyNode === currentProxy
}

export function canExecuteRecoveryLevel(
  level: RecoveryLevel,
  cooldowns: RecoveryCooldownState,
  nowMs: number = Date.now()
): boolean {
  switch (level) {
    case 'L0':
      return nowMs - cooldowns.lastL0AtMs >= RECOVERY_L0_COOLDOWN_MS
    case 'L1':
      return nowMs - cooldowns.lastL1AtMs >= RECOVERY_L1_COOLDOWN_MS
    case 'L2':
      return nowMs - cooldowns.lastL2AtMs >= RECOVERY_L2_COOLDOWN_MS
    case 'L3':
      return nowMs - cooldowns.lastL3AtMs >= RECOVERY_L3_COOLDOWN_MS
    default:
      return false
  }
}

export function decideRecoveryAction(context: RecoveryDecisionContext): RecoveryAction {
  const nowMs = context.nowMs ?? Date.now()

  if (context.attribution === 'healthy') {
    return 'none'
  }

  // Never L0-close Agent SSE from zero mihomo throughput (tool/thinking idle is normal).

  if (
    context.attribution === 'transport_partition_stale' &&
    canExecuteRecoveryLevel('L1', context.cooldowns, nowMs)
  ) {
    return 'L1'
  }

  if (context.tunInterfaceLostConfirmed && canExecuteRecoveryLevel('L2', context.cooldowns, nowMs)) {
    return 'L2'
  }

  if (
    context.priorRecoveryFailed &&
    !context.probe.api2Ok &&
    canExecuteRecoveryLevel('L3', context.cooldowns, nowMs)
  ) {
    return 'L3'
  }

  if (
    context.attribution === 'node_degraded' &&
    !context.probe.api2Ok &&
    context.priorRecoveryFailed &&
    canExecuteRecoveryLevel('L3', context.cooldowns, nowMs)
  ) {
    return 'L3'
  }

  return 'none'
}

/** Human-readable reason when unhealthy but {@link decideRecoveryAction} returns `none` (cooldown / ladder not ready). */
export function describeRecoveryBlockReason(context: RecoveryDecisionContext): string | undefined {
  const nowMs = context.nowMs ?? Date.now()

  if (context.attribution === 'healthy') {
    return undefined
  }

  const intended: RecoveryLevel[] = []
  if (context.attribution === 'transport_partition_stale') {
    intended.push('L1')
  }
  if (context.tunInterfaceLostConfirmed) {
    intended.push('L2')
  }
  if (context.priorRecoveryFailed && !context.probe.api2Ok) {
    intended.push('L3')
  }

  for (const level of intended) {
    if (!canExecuteRecoveryLevel(level, context.cooldowns, nowMs)) {
      return `${level}_cooldown`
    }
  }

  if (context.priorRecoveryFailed === false && !context.probe.api2Ok) {
    return 'awaiting_prior_recovery_failure_for_L3'
  }

  return 'ladder_not_ready'
}

/** Marathon idle cleanup threshold — unchanged from hygiene SSOT. */
export function isMarathonIdleCursorConnection(row: ConnectionHygieneRow, nowMs: number): boolean {
  if (nowMs - row.startMs < CURSOR_CONN_IDLE_MIN_AGE_MS) {
    return false
  }
  return row.uploadSpeed <= 0 && row.downloadSpeed <= 0
}
