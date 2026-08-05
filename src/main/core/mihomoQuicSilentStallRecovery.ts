// [INPUT] mihomoQuicSilentStallRecoveryCore · hy2TunnelVitality · mihomoApi · frozenSurgicalPrune · recoveryHonesty
// [OUTPUT] executeMihomoQuicStallRecoveryIfDue · token gap snapshot · recovery honesty eval
// [POS] R-33/R-34 runtime — stall-triggered vitality + frozen surgical prune + parent rotation.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { appendAppLog } from '../utils/log'
import { mihomoCloseConnection } from './mihomoApi'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import type { MihomoQuicStallTrackedConnection } from './mihomoQuicSilentStallCore'
import {
  resolveHy2ParentRotationAfterPrunePlan,
  type Hy2ParentRotationPlan,
} from './hy2ParentRotationCore'
import {
  resolveFrozenSurgicalPrunePlan,
  type FrozenSurgicalPruneAction,
} from './frozenSurgicalPruneCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'
import {
  evaluateRecoveryHonesty,
  formatRecoveryHonestyLogLine,
  shouldEvaluateRecoveryHonesty,
  type RecoveryHonestyAttemptRecord,
} from './recoveryHonestyCore'
import { resolveStallRecoveryCloseTarget } from './marathonCarrierConnectionBindCore'
import { CURSOR_HY2_TOKEN_GAP_FORCE_MS } from './cursorHy2MarathonKeepaliveCore'
import {
  formatStallEscalationLadderLogLine,
  markStallEscalationExecuted,
  recordVitalityByteSnapshot,
  resetStallEscalationLadderStateForTests,
  resolveStallEscalationLadderPlan,
  type StallEscalationLadderAction,
} from './stallEscalationLadderCore'
import { isCriticalCursorHost } from './cursorCriticalTransportCore'
import {
  formatMihomoQuicStallRecoveryLogLine,
  MIHOMO_QUIC_STALL_VITALITY_TRIGGER_MS,
  type MihomoQuicStallRecoveryAction,
} from './mihomoQuicSilentStallRecoveryCore'

const lastRecoveryAtMsByConnectionId = new Map<string, number>()
let lastGlobalPruneAtMs = 0
let lastHy2ParentRotationAtMs = 0
let skipRecoveryAppLogForTests = false

let latestTokenGapSnapshot: { maxGapMs: number; staleRequestIdCount: number } = {
  maxGapMs: 0,
  staleRequestIdCount: 0,
}

let latestMarathonRecoveryContext: {
  marathonActive: boolean
  registryMaxGapSinceActivityMs: number
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  staleRequestIds: string[]
  registry: MarathonStreamRegistry
} = {
  marathonActive: false,
  registryMaxGapSinceActivityMs: 0,
  httpParentChainAgeMs: 0,
  outboundHy2SessionAgeMs: 0,
  staleRequestIds: [],
  registry: { records: new Map() },
}

let pendingRecoveryHonesty: RecoveryHonestyAttemptRecord | undefined

let latestLongevitySnapshot: TransportLongevityTruthSnapshot | undefined
let latestConnections: readonly ControllerConnectionDetail[] = []
let latestTrackedFirstSeenAtMsById = new Map<string, number>()
let latestTrackedLastByteChangeAtMsById = new Map<string, number>()

export function resetMihomoQuicSilentStallRecoveryForTests(): void {
  lastRecoveryAtMsByConnectionId.clear()
  lastGlobalPruneAtMs = 0
  lastHy2ParentRotationAtMs = 0
  skipRecoveryAppLogForTests = false
  latestTokenGapSnapshot = { maxGapMs: 0, staleRequestIdCount: 0 }
  pendingRecoveryHonesty = undefined
  latestLongevitySnapshot = undefined
  latestConnections = []
  latestTrackedFirstSeenAtMsById = new Map()
  latestTrackedLastByteChangeAtMsById = new Map()
  latestMarathonRecoveryContext = {
    marathonActive: false,
    registryMaxGapSinceActivityMs: 0,
    httpParentChainAgeMs: 0,
    outboundHy2SessionAgeMs: 0,
    staleRequestIds: [],
    registry: { records: new Map() },
  }
  resetStallEscalationLadderStateForTests()
}

export function setSkipMihomoQuicSilentStallRecoveryAppLogForTests(skip: boolean): void {
  skipRecoveryAppLogForTests = skip
}

export function setMarathonTokenGapSnapshotForRecovery(snapshot: {
  maxGapMs: number
  staleRequestIdCount: number
}): void {
  latestTokenGapSnapshot = {
    maxGapMs: Math.max(0, snapshot.maxGapMs),
    staleRequestIdCount: Math.max(0, snapshot.staleRequestIdCount),
  }
}

export function getMarathonTokenGapSnapshotForMutationGate(): {
  maxGapMs: number
  staleRequestIdCount: number
} {
  return {
    maxGapMs: latestTokenGapSnapshot.maxGapMs,
    staleRequestIdCount: latestTokenGapSnapshot.staleRequestIdCount,
  }
}

export function recordRecoveryHonestyAttempt(record: RecoveryHonestyAttemptRecord): void {
  pendingRecoveryHonesty = record
}

export function setMarathonRecoveryContextForPrune(input: {
  marathonActive: boolean
  registryMaxGapSinceActivityMs: number
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
  staleRequestIds?: readonly string[]
  registry?: MarathonStreamRegistry
}): void {
  latestMarathonRecoveryContext = {
    marathonActive: input.marathonActive,
    registryMaxGapSinceActivityMs: Math.max(0, input.registryMaxGapSinceActivityMs),
    httpParentChainAgeMs: Math.max(0, input.httpParentChainAgeMs ?? 0),
    outboundHy2SessionAgeMs: Math.max(0, input.outboundHy2SessionAgeMs ?? 0),
    staleRequestIds: [...(input.staleRequestIds ?? [])],
    registry: input.registry ?? { records: new Map() },
  }
}

export function setTransportLongevityContextForRecovery(input: {
  snapshot: TransportLongevityTruthSnapshot
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
}): void {
  latestLongevitySnapshot = input.snapshot
  latestConnections = input.connections
  latestTrackedFirstSeenAtMsById = new Map(input.trackedFirstSeenAtMsById)
  latestTrackedLastByteChangeAtMsById = new Map(input.trackedLastByteChangeAtMsById)
}

async function logRecovery(line: string): Promise<void> {
  if (skipRecoveryAppLogForTests) {
    return
  }
  await appendAppLog(line)
}

async function runStallVitalityDial(
  leaf: string,
  cursorConnectionCount: number,
  nowMs: number,
): Promise<{ ok: boolean; delayMs?: number; err?: string }> {
  try {
    const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
    const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
    const { runHy2TunnelVitalityIfDue } = await import('./hy2TunnelVitality')
    const result = await runHy2TunnelVitalityIfDue(leaf, cursorConnectionCount, nowMs, truth, {
      stallRecoveryBypass: true,
    })
    if (result.outcome === 'executed') {
      return { ok: true, delayMs: result.connectPathDelayMs }
    }
    if (result.outcome === 'skipped_in_flight' || result.outcome === 'skipped_not_due') {
      return { ok: true, delayMs: result.connectPathDelayMs }
    }
    return { ok: false, err: result.outcome }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

async function closeStalledConnection(connectionId: string): Promise<{ ok: boolean; err?: string }> {
  try {
    await mihomoCloseConnection(connectionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

function markRecovery(connectionId: string | undefined, nowMs: number): void {
  if (!connectionId) {
    return
  }
  lastRecoveryAtMsByConnectionId.set(connectionId, nowMs)
}

function mapPruneActionToRecoveryAction(action: FrozenSurgicalPruneAction): MihomoQuicStallRecoveryAction {
  if (action === 'close_frozen_connection') {
    return 'close_connection'
  }
  if (action === 'vitality_dial') {
    return 'vitality_dial'
  }
  return 'none'
}

function connectionBytesForObservation(
  observation: MihomoQuicSilentStallObservation,
): { upload: number; download: number } {
  const connectionId = observation.connectionId?.trim()
  if (!connectionId) {
    return { upload: 0, download: 0 }
  }
  const connection = latestConnections.find((entry) => entry.id === connectionId)
  return {
    upload: connection?.upload ?? 0,
    download: connection?.download ?? 0,
  }
}

function resolveRecoveryHonestyCurrentCarrier(
  record: RecoveryHonestyAttemptRecord,
): { upload: number; download: number } | undefined {
  const connectionId = record.connectionId?.trim()
  if (!connectionId) {
    return undefined
  }
  const connection = latestConnections.find((entry) => entry.id === connectionId)
  if (!connection) {
    return undefined
  }
  return {
    upload: connection.upload ?? 0,
    download: connection.download ?? 0,
  }
}

async function executeStallEscalationLadderIfDue(
  observation: MihomoQuicSilentStallObservation,
  nowMs: number,
): Promise<StallEscalationLadderAction> {
  const bytes = connectionBytesForObservation(observation)
  const plan = resolveStallEscalationLadderPlan({
    observation,
    upload: bytes.upload,
    download: bytes.download,
    nowMs,
  })
  if (plan.action === 'none' || plan.action === 'observe_exhausted') {
    if (plan.action === 'observe_exhausted') {
      await logRecovery(
        formatStallEscalationLadderLogLine({
          outcome: 'observe',
          action: plan.action,
          reason: plan.reason,
          connectionId: observation.connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
        }),
      )
      try {
        const { persistStallEscalationLadderJsonl } = await import('./stallEscalationLadderJsonl')
        await persistStallEscalationLadderJsonl({
          action: plan.action,
          reason: plan.reason,
          connectionId: observation.connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
          leaf: observation.leaf,
          staleRequestIds: latestMarathonRecoveryContext.staleRequestIds,
          cursorConnectionCount: observation.cursorConnectionCount,
          nowMs,
        })
      } catch {
        // app-log remains authoritative if jsonl write fails
      }
    }
    return plan.action
  }

  const connectionId = observation.connectionId?.trim() ?? ''
  if (plan.action === 'emergency_sidecar_dial') {
    if (!latestLongevitySnapshot) {
      await logRecovery(
        formatStallEscalationLadderLogLine({
          outcome: 'skipped',
          action: plan.action,
          reason: 'missing_longevity_snapshot',
          connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
        }),
      )
      return plan.action
    }
    try {
      const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
      const marathonTruth = await resolveMarathonSSETruthNow(observation.cursorConnectionCount)
      const { runHy2ParentSidecarIfDue } = await import('./hy2ParentSidecar')
      await runHy2ParentSidecarIfDue({
        snapshot: latestLongevitySnapshot,
        connections: latestConnections,
        trackedFirstSeenAtMsById: latestTrackedFirstSeenAtMsById,
        trackedLastByteChangeAtMsById: latestTrackedLastByteChangeAtMsById,
        marathonTruth,
        cursorConnectionCount: observation.cursorConnectionCount,
        nowMs,
        emergencyStallEscalation: true,
      })
      markStallEscalationExecuted({ connectionId, action: plan.action, nowMs })
      await logRecovery(
        formatStallEscalationLadderLogLine({
          outcome: 'executed',
          action: plan.action,
          reason: plan.reason,
          connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
        }),
      )
      try {
        const { persistStallEscalationLadderJsonl } = await import('./stallEscalationLadderJsonl')
        await persistStallEscalationLadderJsonl({
          action: plan.action,
          reason: plan.reason,
          connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
          leaf: observation.leaf,
          staleRequestIds: latestMarathonRecoveryContext.staleRequestIds,
          cursorConnectionCount: observation.cursorConnectionCount,
          nowMs,
        })
      } catch {
        // app-log remains authoritative
      }
    } catch (error) {
      await logRecovery(
        formatStallEscalationLadderLogLine({
          outcome: 'failed',
          action: plan.action,
          reason: plan.reason,
          connectionId,
          host: observation.host,
          stallMs: observation.stallMs,
          upload: bytes.upload,
          download: bytes.download,
          err: formatUnknownErrorForLog(error),
        }),
      )
    }
    return plan.action
  }

  if (plan.action === 'parent_udp_refresh') {
    await maybeRunHy2ParentRotationAfterPrune(nowMs, true)
    markStallEscalationExecuted({ connectionId, action: plan.action, nowMs })
    await logRecovery(
      formatStallEscalationLadderLogLine({
        outcome: 'executed',
        action: plan.action,
        reason: plan.reason,
        connectionId,
        host: observation.host,
        stallMs: observation.stallMs,
        upload: bytes.upload,
        download: bytes.download,
      }),
    )
    return plan.action
  }

  return plan.action
}

async function maybeRunHy2ParentRotationAfterPrune(
  nowMs: number,
  emergencyStallEscalation = false,
): Promise<void> {
  if (!latestLongevitySnapshot || latestConnections.length === 0) {
    return
  }
  const plan: Hy2ParentRotationPlan = resolveHy2ParentRotationAfterPrunePlan({
    snapshot: latestLongevitySnapshot,
    connections: latestConnections,
    trackedFirstSeenAtMsById: latestTrackedFirstSeenAtMsById,
    trackedLastByteChangeAtMsById: latestTrackedLastByteChangeAtMsById,
    lastRotationAtMs: lastHy2ParentRotationAtMs,
    nowMs,
    emergencyStallEscalation,
  })
  if (plan.action !== 'close_udp_outbound' || !plan.udpConnectionId) {
    return
  }
  const closed = await closeStalledConnection(plan.udpConnectionId)
  lastHy2ParentRotationAtMs = nowMs
  await logRecovery(
    `[Hy2ParentRotation]: outcome=${closed.ok ? 'executed' : 'failed'} reason=${plan.reason}` +
      ` udp_connection_id=${plan.udpConnectionId}` +
      ` outbound_hy2_session_age_ms=${latestLongevitySnapshot.outboundHy2SessionAgeMs}` +
      (closed.err ? ` err=${closed.err}` : '') +
      `\n`,
  )
}

export async function evaluatePendingRecoveryHonestyIfDue(nowMs: number = Date.now()): Promise<void> {
  if (!shouldEvaluateRecoveryHonesty(pendingRecoveryHonesty, nowMs) || !pendingRecoveryHonesty) {
    return
  }
  const evaluation = evaluateRecoveryHonesty({
    record: pendingRecoveryHonesty,
    nowMs,
    currentMaxGapMs: latestTokenGapSnapshot.maxGapMs,
    staleRequestIds: [],
    currentCarrier: resolveRecoveryHonestyCurrentCarrier(pendingRecoveryHonesty),
  })
  await logRecovery(formatRecoveryHonestyLogLine(evaluation))
  pendingRecoveryHonesty = undefined
}

function buildRecoveryTriageLogFields(plan: {
  reason: string
  carrierRid?: string
  staleProofKind?: string
}): {
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  registryMaxGapSinceActivityMs: number
  tokenGapMaxMs: number
  pruneDenialReason?: string
  carrierRid?: string
  staleProofKind?: string
  marathonActive?: boolean
} {
  const pruneDenialReason =
    plan.reason !== 'frozen_surgical_prune' && plan.reason !== 'marathon_sse_carrier_frozen_prune'
      ? plan.reason
      : undefined
  return {
    httpParentChainAgeMs:
      latestLongevitySnapshot?.httpParentChainAgeMs ?? latestMarathonRecoveryContext.httpParentChainAgeMs,
    outboundHy2SessionAgeMs:
      latestLongevitySnapshot?.outboundHy2SessionAgeMs ?? latestMarathonRecoveryContext.outboundHy2SessionAgeMs,
    registryMaxGapSinceActivityMs: latestMarathonRecoveryContext.registryMaxGapSinceActivityMs,
    tokenGapMaxMs: latestTokenGapSnapshot.maxGapMs,
    pruneDenialReason,
    carrierRid: plan.carrierRid,
    staleProofKind: plan.staleProofKind,
    marathonActive: latestMarathonRecoveryContext.marathonActive,
  }
}

export async function executeMihomoQuicStallRecoveryIfDue(
  observation: MihomoQuicSilentStallObservation,
  nowMs: number = Date.now(),
): Promise<MihomoQuicStallRecoveryAction> {
  await evaluatePendingRecoveryHonestyIfDue(nowMs)

  const plan = resolveFrozenSurgicalPrunePlan({
    observation,
    tokenGapMaxMs: latestTokenGapSnapshot.maxGapMs,
    staleRequestIdCount: latestTokenGapSnapshot.staleRequestIdCount,
    lastGlobalPruneAtMs,
    lastRecoveryAtMsByConnectionId,
    nowMs,
    marathonActive: latestMarathonRecoveryContext.marathonActive,
    registryMaxGapSinceActivityMs: latestMarathonRecoveryContext.registryMaxGapSinceActivityMs,
    registry: latestMarathonRecoveryContext.registry,
    staleRequestIds: latestMarathonRecoveryContext.staleRequestIds,
    httpParentChainAgeMs: latestLongevitySnapshot?.httpParentChainAgeMs ?? latestMarathonRecoveryContext.httpParentChainAgeMs,
    outboundHy2SessionAgeMs: latestLongevitySnapshot?.outboundHy2SessionAgeMs ?? latestMarathonRecoveryContext.outboundHy2SessionAgeMs,
  })
  const action = mapPruneActionToRecoveryAction(plan.action)
  const triageFields = buildRecoveryTriageLogFields(plan)

  if (plan.action === 'none') {
    if (
      observation.kind === 'single' &&
      isCriticalCursorHost(observation.host?.trim() ?? '') &&
      observation.stallMs >= MIHOMO_QUIC_STALL_VITALITY_TRIGGER_MS
    ) {
      await executeStallEscalationLadderIfDue(observation, nowMs)
    }
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: 'skipped',
        action,
        reason: plan.reason,
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
        ...triageFields,
      }),
    )
    return action
  }

  if (plan.action === 'vitality_dial') {
    const bytes = connectionBytesForObservation(observation)
    const vitality = await runStallVitalityDial(
      observation.leaf,
      observation.cursorConnectionCount,
      nowMs,
    )
    if (observation.connectionId) {
      recordVitalityByteSnapshot({
        connectionId: observation.connectionId,
        upload: bytes.upload,
        download: bytes.download,
        nowMs,
      })
    }
    markRecovery(observation.connectionId, nowMs)
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: vitality.ok ? 'executed' : 'failed',
        action,
        reason: plan.reason,
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
        vitalityDelayMs: vitality.delayMs,
        err: vitality.err,
        ...triageFields,
      }),
    )
    await executeStallEscalationLadderIfDue(observation, nowMs)
    return action
  }

  const observationHost = observation.host?.trim() ?? ''
  if (isCriticalCursorHost(observationHost)) {
    await executeStallEscalationLadderIfDue(observation, nowMs)
    const vitality = await runStallVitalityDial(
      observation.leaf,
      observation.cursorConnectionCount,
      nowMs,
    )
    markRecovery(observation.connectionId, nowMs)
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: vitality.ok ? 'executed' : 'failed',
        action: 'vitality_dial',
        reason: 'r41_critical_host_close_blocked',
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
        vitalityDelayMs: vitality.delayMs,
        err: vitality.err,
        ...triageFields,
      }),
    )
    return 'vitality_dial'
  }

  const trackedByIdForClose = new Map<string, MihomoQuicStallTrackedConnection>()
  for (const [id, firstSeenAtMs] of latestTrackedFirstSeenAtMsById) {
    const lastBytesChangeAtMs = latestTrackedLastByteChangeAtMsById.get(id) ?? firstSeenAtMs
    const connection = latestConnections.find((entry) => entry.id === id)
    trackedByIdForClose.set(id, {
      upload: connection?.upload ?? 0,
      download: connection?.download ?? 0,
      lastBytesChangeAtMs,
      firstSeenAtMs,
      host: connection ? String(connection.metadata?.host ?? '') : '',
      leaf: observation.leaf,
      network: String(connection?.metadata?.network ?? ''),
    })
  }
  const closeTargetResolved = resolveStallRecoveryCloseTarget({
    observation,
    carrierRid: plan.carrierRid,
    registry: latestMarathonRecoveryContext.registry,
    connections: latestConnections,
    trackedById: trackedByIdForClose,
    nowMs,
  })
  const closeConnectionId = closeTargetResolved.connectionId.trim()
  if (!closeConnectionId) {
    const denyReason =
      closeTargetResolved.closeTargetSource === 'deny_unbound_critical_host'
        ? 'deny_unbound_critical_host'
        : 'carrier_close_target_unresolved'
    const vitality = await runStallVitalityDial(
      observation.leaf,
      observation.cursorConnectionCount,
      nowMs,
    )
    markRecovery(observation.connectionId, nowMs)
    await logRecovery(
      formatMihomoQuicStallRecoveryLogLine({
        outcome: vitality.ok ? 'executed' : 'failed',
        action: 'vitality_dial',
        reason: denyReason,
        leaf: observation.leaf,
        stallMs: observation.stallMs,
        cursorConnectionCount: observation.cursorConnectionCount,
        connectionId: observation.connectionId,
        host: observation.host,
        observationConnectionId: observation.connectionId,
        closeTargetSource: closeTargetResolved.closeTargetSource,
        vitalityDelayMs: vitality.delayMs,
        err: vitality.err,
        ...triageFields,
      }),
    )
    return 'vitality_dial'
  }

  const closed = await closeStalledConnection(closeConnectionId)
  markRecovery(closeConnectionId, nowMs)
  if (observation.connectionId && observation.connectionId !== closeConnectionId) {
    markRecovery(observation.connectionId, nowMs)
  }
  lastGlobalPruneAtMs = nowMs
  const pruneBytes = connectionBytesForObservation(observation)
  pendingRecoveryHonesty = {
    kind: 'stall_prune',
    attemptedAtMs: nowMs,
    baselineMaxGapMs: latestTokenGapSnapshot.maxGapMs,
    staleRequestIds: plan.carrierRid ? [plan.carrierRid] : [],
    baselineCarrier: { upload: pruneBytes.upload, download: pruneBytes.download },
    requireCarrierBytesRecovery: true,
    connectionId: closeConnectionId,
  }
  await logRecovery(
    formatMihomoQuicStallRecoveryLogLine({
      outcome: closed.ok ? 'executed' : 'failed',
      action,
      reason: plan.reason,
      leaf: observation.leaf,
      stallMs: observation.stallMs,
      cursorConnectionCount: observation.cursorConnectionCount,
      connectionId: closeConnectionId,
      host: closeTargetResolved.host ?? observation.host,
      observationConnectionId: observation.connectionId,
      closeTargetSource: closeTargetResolved.closeTargetSource,
      err: closed.err,
      ...triageFields,
    }),
  )
  if (closed.ok) {
    await maybeRunHy2ParentRotationAfterPrune(nowMs)
    await runStallVitalityDial(observation.leaf, observation.cursorConnectionCount, nowMs)
  }
  return action
}

export const TOKEN_GAP_INEFFECTIVE_ESCALATION_COOLDOWN_MS = 120_000

let lastTokenGapIneffectiveEscalationAtMs = 0

export function resetTokenGapIneffectiveEscalationForTests(): void {
  lastTokenGapIneffectiveEscalationAtMs = 0
}

export async function executeTokenGapIneffectiveEscalationIfDue(
  input: {
    maxGapMs: number
    staleRequestIds: readonly string[]
    observation: MihomoQuicSilentStallObservation | undefined
  },
  nowMs: number = Date.now(),
): Promise<MihomoQuicStallRecoveryAction> {
  if (
    nowMs - lastTokenGapIneffectiveEscalationAtMs <
    TOKEN_GAP_INEFFECTIVE_ESCALATION_COOLDOWN_MS
  ) {
    return 'none'
  }
  const staleRequestIdCount = Math.max(
    input.staleRequestIds.length,
    latestTokenGapSnapshot.staleRequestIdCount,
    input.maxGapMs >= CURSOR_HY2_TOKEN_GAP_FORCE_MS ? 1 : 0,
  )
  setMarathonTokenGapSnapshotForRecovery({
    maxGapMs: Math.max(input.maxGapMs, latestTokenGapSnapshot.maxGapMs),
    staleRequestIdCount,
  })
  if (input.staleRequestIds.length > 0) {
    setMarathonRecoveryContextForPrune({
      marathonActive: latestMarathonRecoveryContext.marathonActive,
      registryMaxGapSinceActivityMs: latestMarathonRecoveryContext.registryMaxGapSinceActivityMs,
      httpParentChainAgeMs: latestMarathonRecoveryContext.httpParentChainAgeMs,
      outboundHy2SessionAgeMs: latestMarathonRecoveryContext.outboundHy2SessionAgeMs,
      staleRequestIds: [...input.staleRequestIds],
      registry: latestMarathonRecoveryContext.registry,
    })
  }
  const observation = input.observation
  if (!observation || observation.kind !== 'single') {
    return 'none'
  }
  lastTokenGapIneffectiveEscalationAtMs = nowMs
  return executeMihomoQuicStallRecoveryIfDue(observation, nowMs)
}
