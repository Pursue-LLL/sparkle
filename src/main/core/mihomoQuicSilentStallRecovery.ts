// [INPUT] mihomoQuicSilentStallRecoveryCore · hy2TunnelVitality · mihomoApi · frozenSurgicalPrune · recoveryHonesty
// [OUTPUT] executeMihomoQuicStallRecoveryIfDue · token gap snapshot · recovery honesty eval
// [POS] R-33/R-34 runtime — stall-triggered vitality + frozen surgical prune + parent rotation.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { appendAppLog } from '../utils/log'
import { mihomoCloseConnection } from './mihomoApi'
import type { MihomoQuicSilentStallObservation } from './mihomoQuicSilentStallCore'
import {
  resolveHy2ParentRotationAfterPrunePlan,
  type Hy2ParentRotationPlan,
} from './hy2ParentRotationCore'
import {
  resolveFrozenSurgicalPrunePlan,
  type FrozenSurgicalPruneAction,
} from './frozenSurgicalPruneCore'
import type { TransportLongevityTruthSnapshot } from './transportLongevityTruthCore'
import {
  evaluateRecoveryHonesty,
  formatRecoveryHonestyLogLine,
  shouldEvaluateRecoveryHonesty,
  type RecoveryHonestyAttemptRecord,
} from './recoveryHonestyCore'
import {
  formatMihomoQuicStallRecoveryLogLine,
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
} = {
  marathonActive: false,
  registryMaxGapSinceActivityMs: 0,
  httpParentChainAgeMs: 0,
  outboundHy2SessionAgeMs: 0,
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
  }
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

export function recordRecoveryHonestyAttempt(record: RecoveryHonestyAttemptRecord): void {
  pendingRecoveryHonesty = record
}

export function setMarathonRecoveryContextForPrune(input: {
  marathonActive: boolean
  registryMaxGapSinceActivityMs: number
  httpParentChainAgeMs?: number
  outboundHy2SessionAgeMs?: number
}): void {
  latestMarathonRecoveryContext = {
    marathonActive: input.marathonActive,
    registryMaxGapSinceActivityMs: Math.max(0, input.registryMaxGapSinceActivityMs),
    httpParentChainAgeMs: Math.max(0, input.httpParentChainAgeMs ?? 0),
    outboundHy2SessionAgeMs: Math.max(0, input.outboundHy2SessionAgeMs ?? 0),
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

async function maybeRunHy2ParentRotationAfterPrune(nowMs: number): Promise<void> {
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
  })
  await logRecovery(formatRecoveryHonestyLogLine(evaluation))
  pendingRecoveryHonesty = undefined
}

function buildRecoveryTriageLogFields(planReason: string): {
  httpParentChainAgeMs: number
  outboundHy2SessionAgeMs: number
  registryMaxGapSinceActivityMs: number
  tokenGapMaxMs: number
  pruneDenialReason?: string
} {
  const pruneDenialReason =
    planReason !== 'frozen_surgical_prune' && planReason !== 'marathon_sse_carrier_frozen_prune'
      ? planReason
      : undefined
  return {
    httpParentChainAgeMs:
      latestLongevitySnapshot?.httpParentChainAgeMs ?? latestMarathonRecoveryContext.httpParentChainAgeMs,
    outboundHy2SessionAgeMs:
      latestLongevitySnapshot?.outboundHy2SessionAgeMs ?? latestMarathonRecoveryContext.outboundHy2SessionAgeMs,
    registryMaxGapSinceActivityMs: latestMarathonRecoveryContext.registryMaxGapSinceActivityMs,
    tokenGapMaxMs: latestTokenGapSnapshot.maxGapMs,
    pruneDenialReason,
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
    httpParentChainAgeMs: latestLongevitySnapshot?.httpParentChainAgeMs ?? latestMarathonRecoveryContext.httpParentChainAgeMs,
    outboundHy2SessionAgeMs: latestLongevitySnapshot?.outboundHy2SessionAgeMs ?? latestMarathonRecoveryContext.outboundHy2SessionAgeMs,
  })
  const action = mapPruneActionToRecoveryAction(plan.action)
  const triageFields = buildRecoveryTriageLogFields(plan.reason)

  if (plan.action === 'none') {
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
    const vitality = await runStallVitalityDial(
      observation.leaf,
      observation.cursorConnectionCount,
      nowMs,
    )
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
    return action
  }

  const closed = await closeStalledConnection(observation.connectionId ?? '')
  markRecovery(observation.connectionId, nowMs)
  lastGlobalPruneAtMs = nowMs
  pendingRecoveryHonesty = {
    kind: 'stall_prune',
    attemptedAtMs: nowMs,
    baselineMaxGapMs: latestTokenGapSnapshot.maxGapMs,
    staleRequestIds: [],
  }
  await logRecovery(
    formatMihomoQuicStallRecoveryLogLine({
      outcome: closed.ok ? 'executed' : 'failed',
      action,
      reason: plan.reason,
      leaf: observation.leaf,
      stallMs: observation.stallMs,
      cursorConnectionCount: observation.cursorConnectionCount,
      connectionId: observation.connectionId,
      host: observation.host,
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
