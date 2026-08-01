// [INPUT] MTDO core · stream registry · HY2 keepalive · marathonContentionBudgetCore · mihomoQuicSilentStallObserver
// [OUTPUT] runMarathonTransportDialCycle · resetMarathonTransportDialOrchestratorForTests
// [POS] MTDO executor: hung_scan cycle · independent 60s pulse · R-24 rescue/independent breach split.

import { appendAppLog } from '../utils/log'
import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { mihomoProxyDelay } from './mihomoApi'
import { readConnectPartitionSignalAsync } from './connectPartitionReader'
import { ensureCursorMarathonKeepAlive } from './cursorNetworkOptimize'
import { getRecentCursorProbe } from './networkStabilityMonitor'
import {
  API2DIRECT_PROBE_TARGET,
  CONNECT_PATH_PROBE_TARGET,
  detectConnectStreamPartitionStale,
} from './cursorConnectStreamKeepaliveCore'
import {
  formatMarathonRescueNudgeLogLine,
  resolveRescueDialLogOutcome,
  shouldForceHy2MarathonSessionKeepaliveForHighLatency,
  type MarathonSessionKeepaliveResult,
} from './cursorHy2MarathonKeepaliveCore'
import {
  resolveCursorDedicatedActiveNode,
} from './cursorHy2MarathonKeepalive'
import { executeMarathonRescueDial } from './marathonRescueDialExecutor'
import { executeMarathonWarmthDial } from './marathonWarmthDialExecutor'
import {
  readConnectStreamKeepaliveGapSignal,
  readMarathonColdResumeNoTokenSignal,
  readMarathonSilentGenerationEndRescueSignal,
  readMarathonStreamTokenGapSignal,
} from './cursorStreamTokenGapReader'
import { evaluateLatencyDeltaFromSummary } from './latencyDeltaGateCore'
import {
  buildSyntheticConnectPartitionSignal,
  formatUltraConnObservabilityLine,
  isLatencyDeltaRescueEligible,
  mergeConnectPartitionSignals,
  nextLatencyDeltaRescueStreak,
  nextWarmthDeferStreak,
  resolveRecentVpsL4OkForNode,
  shouldCountWarmthDeferStreak,
  shouldEmitSyntheticConnectPartition,
  shouldEmitUltraConnObservability,
  VPS_L4_OK_LOOKBACK_MS,
  type ConnectPartitionSignalWithSource,
} from './connectPingStormCore'
import {
  resolveMarathonTokenGapRecoverySnapshot,
  type MarathonTokenGapRecoverySnapshot,
} from './marathonTokenGapSnapshotRetentionCore'
import {
  hasActiveMarathonStream,
  isTokenGapSuppressedForPendingTool,
  type MarathonStreamRegistry,
} from './marathonStreamRegistryCore'
import { readMarathonSegmentCache } from './marathonSegmentCache'
import { ingestValidatedLedgerTerminals } from './validatedLedgerTerminalIngest'
import { resolveTerminalOriginalRequestIdsFromEvents } from './streamLifecycleProjectionCore'
import {
  MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  MTDO_MARATHON_STREAM_MIN_AGE_MS,
  MTDO_OBSERVABILITY_BUNDLE_MS,
  selectMarathonTransportDialTrigger,
  shouldCoalesceMarathonTransportDial,
  shouldRunIndependentConnectPathPulse,
  type MarathonTransportDialCandidate,
  type MarathonTransportDialPlan,
  type MarathonTransportDialSelectionContext,
} from './marathonTransportDialOrchestratorCore'
import { API2_PROBE_TARGET } from './cursorTransportHealthCore'
import {
  formatPulseContractBreachLine,
  formatPulseSkippedLine,
  isPulseContractBreach,
  resolvePulseSkippedReason,
  type MarathonSSETruthResult,
} from './marathonSSETruthCore'
import { resolveMarathonSSETruthSnapshot } from './marathonSSETruthRuntime'
import { appendNetworkStabilityEvent } from './networkStabilityMonitor'
import {
  formatCursorLogPlaneLine,
  formatPartitionBlindSpotLogLine,
  partitionDetected,
  shouldEmitPartitionBlindSpot,
} from './partitionBlindSpotCore'
import {
  armPartitionLatch,
  clearPartitionLatch,
  collectPartitionLatchRequestIds,
  getPartitionLatchArmedAtMs,
  partitionLatchActive,
  resolvePartitionLatchCandidate,
  shouldArmPartitionLatchFromBlindSpot,
} from './partitionLatchCore'
import {
  formatMarathonTransportPreflightLogLine,
  resolveMarathonTransportPreflight,
} from './marathonTransportPreflightCore'
import {
  evaluateTokenGapRescueIneffective,
  formatTokenGapRescueIneffectiveLogLine,
  shouldRecordTokenGapRescueExecution,
  TOKEN_GAP_RESCUE_INEFFECTIVE_KIND,
  type TokenGapRescueExecutionRecord,
} from './tokenGapRescueIneffectiveCore'
import {
  evaluateConnectPartitionRescueIneffective,
  formatConnectPartitionRescueIneffectiveLogLine,
  shouldRecordConnectPartitionRescueExecution,
  CONNECT_PARTITION_RESCUE_INEFFECTIVE_KIND,
  type ConnectPartitionRescueExecutionRecord,
} from './connectPartitionRescueIneffectiveCore'
import { isHy2TunnelVitalityPrePartitionRisk } from './hy2TunnelVitalityCore'
import {
  buildMarathonContentionBreachKinds,
  evaluateMarathonContentionBudget,
  formatMarathonContentionBudgetLogLine,
  type MarathonContentionBreachKind,
} from './marathonContentionBudgetCore'

export interface ConnectPathPulseResult {
  connectPathDelayMs: number
  api2DelayMs: number
  api2directDelayMs: number
  partitionStale: boolean
}

interface ConnectPathPulseEnsureResult {
  pulse: ConnectPathPulseResult
  executed: boolean
}

let testConnectPathPulseOverride:
  | ((activeNode: string, cursorConnectionCount: number) => Promise<ConnectPathPulseResult>)
  | null = null

export function setConnectPathPulseOverrideForTests(
  override: typeof testConnectPathPulseOverride,
): void {
  testConnectPathPulseOverride = override
}

let lastMtdoDialAtMs = 0
let lastConnectPathPulseAtMs = 0
let lastObservabilityDialAtMs = 0
let lastAuthoritativeConnectPathDelayMs: number | null = null
let lastCachedConnectPathPulse: ConnectPathPulseResult | undefined
let lastConnectPathPartitionStale = false
let lastLatencyDeltaHigh = false
let consecutiveLatencyDeltaHighCycles = 0
let consecutiveWarmthDeferredCount = 0
let cycleConnectPathPulse: ConnectPathPulseResult | undefined
let lastPartitionBlindSpotAtMs = 0
let lastCursorLogPlaneAtMs = 0
let lastMarathonTruthActiveForPreflight = false
let lastTokenGapRescueRecord: TokenGapRescueExecutionRecord | undefined
let lastTokenGapIneffectiveEmitAtMs = 0
let lastConnectPartitionRescueRecord: ConnectPartitionRescueExecutionRecord | undefined
let lastConnectPartitionIneffectiveEmitAtMs = 0
let lastTokenGapRecoverySnapshot: MarathonTokenGapRecoverySnapshot = {
  maxGapMs: 0,
  staleRequestIdCount: 0,
}
let lastTokenGapRecoverySnapshotAtMs = 0

const CURSOR_LOG_PLANE_HEARTBEAT_MS = 60_000
const TOKEN_GAP_INEFFECTIVE_EMIT_COOLDOWN_MS = 120_000
const CONNECT_PARTITION_INEFFECTIVE_EMIT_COOLDOWN_MS = 120_000

export function resetMarathonTransportDialOrchestratorForTests(): void {
  lastMtdoDialAtMs = 0
  lastConnectPathPulseAtMs = 0
  lastObservabilityDialAtMs = 0
  lastAuthoritativeConnectPathDelayMs = null
  lastCachedConnectPathPulse = undefined
  lastConnectPathPartitionStale = false
  lastLatencyDeltaHigh = false
  consecutiveLatencyDeltaHighCycles = 0
  consecutiveWarmthDeferredCount = 0
  cycleConnectPathPulse = undefined
  lastPartitionBlindSpotAtMs = 0
  lastCursorLogPlaneAtMs = 0
  lastMarathonTruthActiveForPreflight = false
  lastTokenGapRescueRecord = undefined
  lastTokenGapIneffectiveEmitAtMs = 0
  lastConnectPartitionRescueRecord = undefined
  lastConnectPartitionIneffectiveEmitAtMs = 0
  lastTokenGapRecoverySnapshot = { maxGapMs: 0, staleRequestIdCount: 0 }
  lastTokenGapRecoverySnapshotAtMs = 0
  testConnectPathPulseOverride = null
}

function formatMtdoLogLine(
  trigger: string,
  outcome: string,
  fields: Record<string, string | number | undefined>,
): string {
  const parts = [`[MarathonTransportDial]: trigger=${trigger}`, `outcome=${outcome}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) {
      parts.push(`${key}=${value}`)
    }
  }
  return `${parts.join(' ')}\n`
}

function buildConnectPathPulseFallback(): ConnectPathPulseResult {
  const delayMs = lastAuthoritativeConnectPathDelayMs ?? 0
  return {
    connectPathDelayMs: delayMs,
    api2DelayMs: delayMs,
    api2directDelayMs: delayMs,
    partitionStale: lastConnectPathPartitionStale,
  }
}

function resolveMarathonContentionBreachInput(options: {
  truth: MarathonSSETruthResult
  lastConnectPathPulseAtMs: number
  nowMs: number
  connectPathPartitionDetected: boolean
  connectPartitionPresent: boolean
  latencyDeltaRescueEligible: boolean
  silentGenerationEndPresent: boolean
  coldResumePresent: boolean
  tokenGapRescueIneffective: boolean
  connectPartitionRescueIneffective: boolean
  frozenQuicCursorCount: number
}) {
  return {
    pulseContractBreach: isPulseContractBreach(
      options.truth,
      options.lastConnectPathPulseAtMs,
      options.nowMs,
    ),
    connectPathPartitionDetected: options.connectPathPartitionDetected,
    connectPartitionPresent: options.connectPartitionPresent,
    latencyDeltaRescueEligible: options.latencyDeltaRescueEligible,
    silentGenerationEndPresent: options.silentGenerationEndPresent,
    coldResumePresent: options.coldResumePresent,
    tokenGapRescueIneffective: options.tokenGapRescueIneffective,
    connectPartitionRescueIneffective: options.connectPartitionRescueIneffective,
    frozenQuicCursorCount: options.frozenQuicCursorCount,
  }
}

function buildContentionBreachKindsForCycle(
  breachInput: ReturnType<typeof resolveMarathonContentionBreachInput>,
  forIndependentPulse: boolean,
): MarathonContentionBreachKind[] {
  return buildMarathonContentionBreachKinds(breachInput, { forIndependentPulse })
}

async function shouldAllowConnectPathPulse(options: {
  nowMs: number
  cursorConnectionCount: number
  independentPulse: boolean
  dialTrigger?: MarathonTransportDialCandidate['trigger']
  breachKinds: readonly MarathonContentionBreachKind[]
}): Promise<boolean> {
  const decision = evaluateMarathonContentionBudget({
    nowMs: options.nowMs,
    lastAuthoritativeConnectPathDelayMs: lastAuthoritativeConnectPathDelayMs,
    lastObservabilityDialAtMs: lastObservabilityDialAtMs,
    breachKinds: options.breachKinds,
    dialTrigger: options.dialTrigger,
    independentPulse: options.independentPulse,
  })
  if (decision.outcome === 'allow') {
    return true
  }
  await appendAppLog(
    formatMarathonContentionBudgetLogLine(decision, {
      cursorConnectionCount: options.cursorConnectionCount,
      independentPulse: options.independentPulse,
      trigger: options.dialTrigger,
      lastDelayMs: lastAuthoritativeConnectPathDelayMs,
    }),
  )
  return false
}

async function executeConnectPathPulse(
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
): Promise<ConnectPathPulseResult> {
  if (testConnectPathPulseOverride) {
    return testConnectPathPulseOverride(activeNode, cursorConnectionCount)
  }
  const incidentGeneration = `connect_path_pulse:${activeNode}:${Math.floor(nowMs / 60_000)}`
  const dialId = `connect_path_pulse:${incidentGeneration}:${nowMs}`
  const { admitDialIntent, completeDialIntent } = await import('./dialAdmissionArbiter')
  const admission = admitDialIntent({
    dialId,
    class: 'active_recovery',
    caller: 'marathonTransportDialOrchestrator.connectPathPulse',
    incidentGeneration,
    node: activeNode,
    submittedAtMs: nowMs,
  })
  if (!admission.admitted) {
    await appendAppLog(
      formatMtdoLogLine('marathon_connect_path_pulse', 'skipped_admission', {
        cursor_conn: cursorConnectionCount,
        node: activeNode,
        reason: admission.reason,
      }),
    )
    return lastCachedConnectPathPulse ?? buildConnectPathPulseFallback()
  }
  const rescueDelayOptions = { purpose: 'marathon_rescue' as const }
  let admissionOutcome: 'SUCCESS' | 'INEFFECTIVE' | 'INCONCLUSIVE' = 'INCONCLUSIVE'
  try {
  const [api2directResult, api2Result, connectPathResult] = await Promise.all([
    mihomoProxyDelay(activeNode, API2DIRECT_PROBE_TARGET, rescueDelayOptions),
    mihomoProxyDelay(activeNode, API2_PROBE_TARGET, rescueDelayOptions),
    mihomoProxyDelay(activeNode, CONNECT_PATH_PROBE_TARGET, rescueDelayOptions),
  ])
  const api2directDelayMs = typeof api2directResult.delay === 'number' ? api2directResult.delay : 0
  const api2DelayMs = typeof api2Result.delay === 'number' ? api2Result.delay : 0
  const connectPathDelayMs = typeof connectPathResult.delay === 'number' ? connectPathResult.delay : 0
  const partitionStale = detectConnectStreamPartitionStale(
    api2directDelayMs,
    api2DelayMs,
    connectPathDelayMs,
  )
  await appendAppLog(
    formatMtdoLogLine('marathon_connect_path_pulse', 'executed', {
      cursor_conn: cursorConnectionCount,
      node: activeNode,
      api2direct_delay_ms: api2directDelayMs,
      api2_delay_ms: api2DelayMs,
      connect_path_delay_ms: connectPathDelayMs,
      partition_stale: partitionStale ? 1 : 0,
    }),
  )
  if (partitionStale) {
    await appendNetworkStabilityEvent({
      ts: new Date().toISOString(),
      kind: 'transport_partition_stale_connect_path',
      probe_ok: true,
      recovery_action: 'none',
      hung_connection_count: cursorConnectionCount,
      error_detail: `pulse api2=${api2DelayMs} connect_path=${connectPathDelayMs}`,
    })
  }
  if (api2DelayMs > 0) {
    const { appendApi2ProbeLedgerRow } = await import('./api2ProbeLedgerCore')
    await appendApi2ProbeLedgerRow({
      ts: new Date().toISOString(),
      scope: 'active',
      node: activeNode,
      latency_ms: api2DelayMs,
      ok: true,
      authoritative: true,
      method: 'marathon_connect_path_pulse',
      probe_via: `mihomo_node:${activeNode}`,
      error_detail: `pulse api2=${api2DelayMs} api2direct=${api2directDelayMs} connect_path=${connectPathDelayMs}`,
    })
  }
  lastObservabilityDialAtMs = nowMs
  lastAuthoritativeConnectPathDelayMs = connectPathDelayMs > 0 ? connectPathDelayMs : lastAuthoritativeConnectPathDelayMs
  lastCachedConnectPathPulse = { connectPathDelayMs, api2DelayMs, api2directDelayMs, partitionStale }
  admissionOutcome = connectPathDelayMs > 0 || api2DelayMs > 0 ? 'SUCCESS' : 'INEFFECTIVE'
  return lastCachedConnectPathPulse
  } catch (error) {
    await appendAppLog(
      formatMtdoLogLine('marathon_connect_path_pulse', 'failed', {
        cursor_conn: cursorConnectionCount,
        node: activeNode,
        err: String(error),
      }),
    )
    admissionOutcome = 'INCONCLUSIVE'
    return lastCachedConnectPathPulse ?? buildConnectPathPulseFallback()
  } finally {
    completeDialIntent(dialId, incidentGeneration, admissionOutcome)
  }
}

async function ensureCycleConnectPathPulse(
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
  options: {
    independentPulse: boolean
    dialTrigger?: MarathonTransportDialCandidate['trigger']
    breachKinds: readonly MarathonContentionBreachKind[]
  },
): Promise<ConnectPathPulseEnsureResult> {
  if (cycleConnectPathPulse) {
    return { pulse: cycleConnectPathPulse, executed: false }
  }
  const allowed = await shouldAllowConnectPathPulse({
    nowMs,
    cursorConnectionCount,
    independentPulse: options.independentPulse,
    dialTrigger: options.dialTrigger,
    breachKinds: options.breachKinds,
  })
  if (!allowed) {
    const fallback = lastCachedConnectPathPulse ?? buildConnectPathPulseFallback()
    cycleConnectPathPulse = fallback
    return { pulse: fallback, executed: false }
  }
  const pulse = await executeConnectPathPulse(activeNode, cursorConnectionCount, nowMs)
  cycleConnectPathPulse = pulse
  lastConnectPathPulseAtMs = nowMs
  lastConnectPathPartitionStale = pulse.partitionStale
  return { pulse, executed: true }
}

async function runIndependentConnectPathPulseIfDue(
  context: MarathonTransportDialSelectionContext,
  truth: MarathonSSETruthResult,
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
  breachKinds: readonly MarathonContentionBreachKind[],
): Promise<void> {
  if (isPulseContractBreach(truth, context.lastConnectPathPulseAtMs, nowMs)) {
    await appendAppLog(
      formatPulseContractBreachLine({
        gapMs: nowMs - context.lastConnectPathPulseAtMs,
        openSegmentCount: truth.openSegmentCount,
        maxParentChainAgeMs: truth.maxParentChainAgeMs,
        cursorConnectionCount,
      }),
    )
  }

  if (shouldRunIndependentConnectPathPulse(context)) {
    const { pulse, executed } = await ensureCycleConnectPathPulse(
      activeNode,
      cursorConnectionCount,
      nowMs,
      {
        independentPulse: true,
        breachKinds,
      },
    )
    if (executed) {
      lastMtdoDialAtMs = nowMs
    }
    if (!pulse.partitionStale) {
      return
    }
    const sessionResult = await executeMarathonRescueDial(cursorConnectionCount, {
      trigger: 'connect_path_partition',
      nowMs,
    })
    await appendAppLog(
      formatMarathonRescueNudgeLogLine('connect_path_partition', sessionResult, {
        cursorConnectionCount,
      }),
    )
    lastMtdoDialAtMs = nowMs
    lastConnectPathPartitionStale = false
    return
  }

  const skippedReason = resolvePulseSkippedReason(
    truth,
    cursorConnectionCount,
    context.lastConnectPathPulseAtMs,
    nowMs,
    Boolean(activeNode),
  )
  if (skippedReason === 'not_due_yet') {
    return
  }
  if (skippedReason && truth.pulseContractDue) {
    await appendAppLog(
      formatPulseSkippedLine(skippedReason, {
        cursor_conn: cursorConnectionCount,
        open_segments: truth.openSegmentCount,
        max_parent_chain_age_ms: truth.maxParentChainAgeMs,
        last_pulse_age_ms:
          context.lastConnectPathPulseAtMs > 0 ? nowMs - context.lastConnectPathPulseAtMs : 0,
      }),
    )
  }
}

async function executeDialPlan(
  candidate: MarathonTransportDialCandidate,
  cursorConnectionCount: number,
  nowMs: number,
  activeNode: string,
  options?: {
    partitionLatchAgeMs?: number
    breachKinds?: readonly MarathonContentionBreachKind[]
  },
): Promise<MarathonSessionKeepaliveResult | { outcome: 'executed' | 'skipped_weak_probe' }> {
  const staleRidLimit = candidate.trigger === 'connect_partition' ? 8 : 3
  const staleRids = candidate.staleRequestIds?.slice(0, staleRidLimit).join(',')
  const rescueLogFields = {
    cursorConnectionCount,
    maxGapMs: candidate.maxGapMs,
    staleRids,
    staleRequestIdCount: candidate.staleRequestIdCount,
    partitionLatchAgeMs: options?.partitionLatchAgeMs,
  }
  const plan: MarathonTransportDialPlan = candidate.plan
  if (plan === 'connect_rescue_bundle') {
    await ensureCycleConnectPathPulse(activeNode, cursorConnectionCount, nowMs, {
      independentPulse: false,
      dialTrigger: candidate.trigger,
      breachKinds: options?.breachKinds ?? [],
    })
    const sessionResult = await executeMarathonRescueDial(cursorConnectionCount, {
      trigger: candidate.trigger,
      maxGapMs: candidate.maxGapMs,
      staleRequestIdCount: candidate.staleRequestIdCount,
      staleRequestIds: candidate.staleRequestIds,
      nowMs,
    })
    await appendAppLog(
      formatMarathonRescueNudgeLogLine(candidate.trigger, sessionResult, rescueLogFields),
    )
    return sessionResult
  }

  if (candidate.trigger === 'periodic_session' || candidate.trigger === 'high_latency_warmth') {
    return executeMarathonWarmthDial(cursorConnectionCount, {
      trigger: candidate.trigger,
      nowMs,
    })
  }

  const sessionResult = await executeMarathonRescueDial(cursorConnectionCount, {
    trigger: candidate.trigger,
    maxGapMs: candidate.maxGapMs,
    staleRequestIdCount: candidate.staleRequestIdCount,
    staleRequestIds: candidate.staleRequestIds,
    nowMs,
  })
  await appendAppLog(
    formatMarathonRescueNudgeLogLine(candidate.trigger, sessionResult, rescueLogFields),
  )
  return sessionResult
}

function updateWarmthDeferStreak(
  cursorConnectionCount: number,
  trigger: MarathonTransportDialCandidate['trigger'],
  outcome: MarathonSessionKeepaliveResult['outcome'],
): void {
  const counted = shouldCountWarmthDeferStreak(cursorConnectionCount, outcome, trigger)
  consecutiveWarmthDeferredCount = nextWarmthDeferStreak(consecutiveWarmthDeferredCount, counted)
  if (outcome === 'executed' && trigger !== 'periodic_session' && trigger !== 'high_latency_warmth') {
    consecutiveWarmthDeferredCount = 0
  }
}

export async function runMarathonTransportDialCycle(cursorConnectionCount: number): Promise<void> {
  try {
    cycleConnectPathPulse = undefined
    const nowMs = Date.now()
    const activeNode = await resolveCursorDedicatedActiveNode()
    if (activeNode) {
      const { readLatencyTruthSummaryForNode } = await import('./api2ProbeLedgerCore')
      const deltaGate = evaluateLatencyDeltaFromSummary(await readLatencyTruthSummaryForNode(activeNode))
      lastLatencyDeltaHigh = deltaGate.high
      consecutiveLatencyDeltaHighCycles = nextLatencyDeltaRescueStreak(
        consecutiveLatencyDeltaHighCycles,
        deltaGate.high,
      )
      if (deltaGate.high && deltaGate.deltaMs != null) {
        await appendNetworkStabilityEvent({
          ts: new Date().toISOString(),
          kind: 'transport_mac_vps_delta_high',
          probe_ok: true,
          recovery_action: 'none',
          hung_connection_count: cursorConnectionCount,
          error_detail: `mac_p50=${deltaGate.summary.macFullPathP50} vps_p50=${deltaGate.summary.vpsBodyP50} delta_ms=${deltaGate.deltaMs}`,
        })
      }
    } else {
      consecutiveLatencyDeltaHighCycles = nextLatencyDeltaRescueStreak(consecutiveLatencyDeltaHighCycles, false)
    }

    const latencyDeltaRescueEligible = isLatencyDeltaRescueEligible(consecutiveLatencyDeltaHighCycles)

    const partitionRead = await readConnectPartitionSignalAsync(cursorConnectionCount, nowMs)
    const jsonlConnectPartition = partitionRead.signal

    if (jsonlConnectPartition) {
      clearPartitionLatch()
    }

    if (
      cursorConnectionCount >= 12 &&
      (nowMs - lastCursorLogPlaneAtMs >= CURSOR_LOG_PLANE_HEARTBEAT_MS ||
        partitionRead.structuredPingCount >= 2)
    ) {
      lastCursorLogPlaneAtMs = nowMs
      await appendAppLog(
        formatCursorLogPlaneLine({
          logRoots: partitionRead.logRoots,
          structuredFiles: partitionRead.structuredFiles,
          mergedRows: partitionRead.structuredRows.length + partitionRead.jsonlRows.length,
          dedupedRows: partitionRead.mergedRows.length,
          partitionDetected: partitionDetected(partitionRead.signal),
          cursorConnectionCount,
        }),
      )
    }

    if (
      shouldEmitPartitionBlindSpot({
        cursorConnectionCount,
        structuredPingCount: partitionRead.structuredPingCount,
        jsonlPingCount: partitionRead.jsonlPingCount,
        partitionSignal: partitionRead.signal,
        nowMs,
        lastEmittedAtMs: lastPartitionBlindSpotAtMs,
      })
    ) {
      lastPartitionBlindSpotAtMs = nowMs
      const blindSpotRequestIds = collectPartitionLatchRequestIds(partitionRead.mergedRows)
      armPartitionLatch(nowMs, blindSpotRequestIds)
      await appendAppLog(
        formatPartitionBlindSpotLogLine({
          structuredPingCount: partitionRead.structuredPingCount,
          jsonlPingCount: partitionRead.jsonlPingCount,
          cursorConnectionCount,
          logRoots: partitionRead.logRoots,
          structuredFiles: partitionRead.structuredFiles,
          mergedRows: partitionRead.structuredRows.length + partitionRead.jsonlRows.length,
          dedupedRows: partitionRead.mergedRows.length,
          partitionDetected: partitionDetected(partitionRead.signal),
          sampleRequestIds: partitionRead.mergedRows
            .map((row) => String(row.originalRequestId || row.requestId || '').trim())
            .filter(Boolean),
        }),
      )
      await appendNetworkStabilityEvent({
        ts: new Date().toISOString(),
        kind: 'transport_partition_blind_spot',
        probe_ok: true,
        recovery_action: 'none',
        hung_connection_count: cursorConnectionCount,
        error_detail:
          `structured_ping=${partitionRead.structuredPingCount}` +
          ` jsonl_ping=${partitionRead.jsonlPingCount}`,
      })
    }
    let vpsL4Ok = false
    if (activeNode) {
      const { readApi2ProbeLedgerSince } = await import('./api2ProbeLedgerCore')
      const vpsRows = await readApi2ProbeLedgerSince(nowMs - VPS_L4_OK_LOOKBACK_MS, 'vps')
      vpsL4Ok = resolveRecentVpsL4OkForNode(vpsRows, activeNode, nowMs)
    }

    const syntheticConnectPartition = shouldEmitSyntheticConnectPartition(
      cursorConnectionCount,
      consecutiveWarmthDeferredCount,
      vpsL4Ok,
      jsonlConnectPartition != null,
    )
      ? buildSyntheticConnectPartitionSignal(cursorConnectionCount)
      : undefined
    const connectPartition: ConnectPartitionSignalWithSource | undefined = mergeConnectPartitionSignals(
      jsonlConnectPartition,
      syntheticConnectPartition,
    )

    if (shouldEmitUltraConnObservability(cursorConnectionCount)) {
      await appendAppLog(
        formatUltraConnObservabilityLine({
          cursorConnectionCount,
          deferredCount: consecutiveWarmthDeferredCount,
          vpsL4Ok,
        }),
      )
    }

    const [
      silentGenerationEnd,
      coldResumeSignal,
      connectStreamGapSignal,
      tokenGapSignal,
      marathonSnapshot,
    ] = await Promise.all([
      readMarathonSilentGenerationEndRescueSignal(cursorConnectionCount, nowMs),
      readMarathonColdResumeNoTokenSignal(cursorConnectionCount, nowMs),
      readConnectStreamKeepaliveGapSignal(cursorConnectionCount, nowMs),
      readMarathonStreamTokenGapSignal(cursorConnectionCount, nowMs),
      resolveMarathonSSETruthSnapshot(cursorConnectionCount, lastConnectPathPulseAtMs),
    ])

    const registry: MarathonStreamRegistry = marathonSnapshot.registry
    const marathonTruth = marathonSnapshot.truth

    const tokenGapRecoveryResolution = resolveMarathonTokenGapRecoverySnapshot({
      fresh: tokenGapSignal
        ? {
            maxGapMs: tokenGapSignal.maxGapMs,
            staleRequestIdCount: tokenGapSignal.staleRequestIds.length,
          }
        : null,
      marathonTruthActive: marathonTruth.marathonTruthActive,
      retained: lastTokenGapRecoverySnapshot,
      retainedAtMs: lastTokenGapRecoverySnapshotAtMs,
      nowMs,
    })
    lastTokenGapRecoverySnapshot = tokenGapRecoveryResolution.snapshot
    lastTokenGapRecoverySnapshotAtMs = tokenGapRecoveryResolution.retainedAtMs
    const { setMarathonTokenGapSnapshotForRecovery } = await import('./mihomoQuicSilentStallRecovery')
    setMarathonTokenGapSnapshotForRecovery(tokenGapRecoveryResolution.snapshot)

    if (
      activeNode &&
      marathonTruth.marathonTruthActive &&
      !lastMarathonTruthActiveForPreflight
    ) {
      const preflight = resolveMarathonTransportPreflight({
        activeNode,
        cursorConnectionCount,
      })
      await appendAppLog(formatMarathonTransportPreflightLogLine(preflight))
    }
    lastMarathonTruthActiveForPreflight = marathonTruth.marathonTruthActive

    const tokenGapSuppressedPendingTool =
      tokenGapSignal != null &&
      isTokenGapSuppressedForPendingTool(
        registry,
        tokenGapSignal.staleRequestIds,
        tokenGapSignal.maxGapMs,
      )
    const marathonStreamActive = hasActiveMarathonStream(registry, nowMs, {
      minStreamAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS,
      maxLastActivityGapMs: MTDO_ACTIVE_STREAM_MAX_GAP_MS,
    })
    const marathonTruthPulseDue = marathonTruth.pulseContractDue

    const recentProbe = getRecentCursorProbe()
    const forceHighLatencyWarmth = shouldForceHy2MarathonSessionKeepaliveForHighLatency(
      cursorConnectionCount,
      recentProbe?.latencyMs ?? 0,
    )

    const [marathonSegments, ledgerTerminals] = await Promise.all([
      readMarathonSegmentCache(nowMs),
      ingestValidatedLedgerTerminals(nowMs),
    ])
    const {
      appendStreamLifecycleJournalEvents,
      mergeStreamLifecycleJournalEvents,
      readStreamLifecycleJournalTail,
    } = await import('./streamLifecycleJournal')
    const { buildStreamLifecycleEventsFromSources } = await import('./streamLifecycleProjectionCore')
    const projectedLifecycleEvents = buildStreamLifecycleEventsFromSources({
      segments: marathonSegments,
      ledgerTerminals,
    })
    const persistedLifecycleEvents = readStreamLifecycleJournalTail()
    const mergedLifecycleEvents = mergeStreamLifecycleJournalEvents(
      persistedLifecycleEvents,
      projectedLifecycleEvents,
    )
    const persistedIds = new Set(persistedLifecycleEvents.map((event) => event.eventId))
    const newLifecycleEvents = projectedLifecycleEvents.filter(
      (event) => !persistedIds.has(event.eventId),
    )
    appendStreamLifecycleJournalEvents(newLifecycleEvents)
    const terminalOriginalRequestIds = resolveTerminalOriginalRequestIdsFromEvents(
      mergedLifecycleEvents,
    )

    const selectionBase: MarathonTransportDialSelectionContext = {
      nowMs,
      cursorConnectionCount,
      lastDialAtMs: lastMtdoDialAtMs,
      lastConnectPathPulseAtMs,
      latencyDeltaHigh: lastLatencyDeltaHigh,
      latencyDeltaRescueEligible,
      connectPartition,
      silentGenerationEnd,
      coldResume: coldResumeSignal,
      tokenGap: tokenGapSignal,
      connectStreamGap: connectStreamGapSignal,
      connectPathPartitionDetected: lastConnectPathPartitionStale,
      tokenGapSuppressedPendingTool,
      marathonStreamActive,
      marathonTruthPulseDue,
      forceHighLatencyWarmth,
      terminalOriginalRequestIds,
    }

    const tokenGapRescueIneffective =
      tokenGapSignal != null &&
      evaluateTokenGapRescueIneffective({
        record: lastTokenGapRescueRecord,
        nowMs,
        maxGapMs: tokenGapSignal.maxGapMs,
        staleRequestIds: tokenGapSignal.staleRequestIds,
        partitionStale: lastConnectPathPartitionStale,
        api2DelayMs: recentProbe?.latencyMs,
      }) != null

    const connectPartitionRescueIneffective =
      connectPartition != null &&
      evaluateConnectPartitionRescueIneffective({
        record: lastConnectPartitionRescueRecord,
        nowMs,
        pingFailureCount: connectPartition.pingFailureCount,
        staleRequestIds: connectPartition.sampleRequestIds,
        connectPathPartitionStale: lastConnectPathPartitionStale,
        api2DelayMs: recentProbe?.latencyMs,
      }) != null

    const { getMarathonFrozenQuicCursorCount } = await import('./mihomoQuicSilentStallObserver')
    const breachInput = resolveMarathonContentionBreachInput({
      truth: marathonTruth,
      lastConnectPathPulseAtMs,
      nowMs,
      connectPathPartitionDetected: lastConnectPathPartitionStale,
      connectPartitionPresent: connectPartition != null,
      latencyDeltaRescueEligible,
      silentGenerationEndPresent: silentGenerationEnd != null,
      coldResumePresent: coldResumeSignal != null,
      tokenGapRescueIneffective,
      connectPartitionRescueIneffective,
      frozenQuicCursorCount: getMarathonFrozenQuicCursorCount(),
    })
    const independentContentionBreachKinds = buildContentionBreachKindsForCycle(breachInput, true)
    const rescueContentionBreachKinds = buildContentionBreachKindsForCycle(breachInput, false)

    if (activeNode && (marathonTruthPulseDue || marathonTruth.marathonTruthActive)) {
      await runIndependentConnectPathPulseIfDue(
        selectionBase,
        marathonTruth,
        activeNode,
        cursorConnectionCount,
        nowMs,
        independentContentionBreachKinds,
      )
      selectionBase.lastConnectPathPulseAtMs = lastConnectPathPulseAtMs
      selectionBase.connectPathPartitionDetected = lastConnectPathPartitionStale
    }

    if (activeNode && marathonTruth.marathonTruthActive) {
      const { runHy2TunnelVitalityIfDue, getLastHy2TunnelVitalityAtMs } = await import(
        './hy2TunnelVitality'
      )
      const vitalityGateInput = {
        nowMs,
        cursorConnectionCount,
        lastVitalityAtMs: getLastHy2TunnelVitalityAtMs(),
        activeNode,
        marathonTruthActive: marathonTruth.marathonTruthActive,
        maxParentChainAgeMs: marathonTruth.maxParentChainAgeMs,
      }
      const prePartitionRisk = isHy2TunnelVitalityPrePartitionRisk(vitalityGateInput)
      const pulseRecentlyRan =
        lastConnectPathPulseAtMs > 0 &&
        nowMs - lastConnectPathPulseAtMs < MTDO_OBSERVABILITY_BUNDLE_MS
      if (!pulseRecentlyRan || prePartitionRisk) {
        await runHy2TunnelVitalityIfDue(activeNode, cursorConnectionCount, nowMs, marathonTruth)
      }
    }

    if (tokenGapSignal) {
      const ineffective = evaluateTokenGapRescueIneffective({
        record: lastTokenGapRescueRecord,
        nowMs,
        maxGapMs: tokenGapSignal.maxGapMs,
        staleRequestIds: tokenGapSignal.staleRequestIds,
        partitionStale: lastConnectPathPartitionStale,
        api2DelayMs: recentProbe?.latencyMs,
      })
      if (
        ineffective &&
        nowMs - lastTokenGapIneffectiveEmitAtMs >= TOKEN_GAP_INEFFECTIVE_EMIT_COOLDOWN_MS
      ) {
        lastTokenGapIneffectiveEmitAtMs = nowMs
        await appendAppLog(formatTokenGapRescueIneffectiveLogLine(ineffective))
        await appendNetworkStabilityEvent({
          ts: new Date(nowMs).toISOString(),
          kind: TOKEN_GAP_RESCUE_INEFFECTIVE_KIND,
          probe_ok: true,
          recovery_action: 'none',
          hung_connection_count: cursorConnectionCount,
          error_detail: `max_gap_ms=${ineffective.maxGapMs} stale_rids=${ineffective.staleRequestIds.slice(0, 3).join(',')}`,
        })
      }
    }

    if (connectPartition) {
      const ineffective = evaluateConnectPartitionRescueIneffective({
        record: lastConnectPartitionRescueRecord,
        nowMs,
        pingFailureCount: connectPartition.pingFailureCount,
        staleRequestIds: connectPartition.sampleRequestIds,
        connectPathPartitionStale: lastConnectPathPartitionStale,
        api2DelayMs: recentProbe?.latencyMs,
      })
      if (
        ineffective &&
        nowMs - lastConnectPartitionIneffectiveEmitAtMs >=
          CONNECT_PARTITION_INEFFECTIVE_EMIT_COOLDOWN_MS
      ) {
        lastConnectPartitionIneffectiveEmitAtMs = nowMs
        await appendAppLog(formatConnectPartitionRescueIneffectiveLogLine(ineffective))
        await appendNetworkStabilityEvent({
          ts: new Date(nowMs).toISOString(),
          kind: CONNECT_PARTITION_RESCUE_INEFFECTIVE_KIND,
          probe_ok: true,
          recovery_action: 'none',
          hung_connection_count: cursorConnectionCount,
          error_detail:
            `ping_failures=${ineffective.pingFailureCount}` +
            ` stale_rids=${ineffective.staleRequestIds.slice(0, 3).join(',')}`,
        })
      }
    }

    let candidate = selectMarathonTransportDialTrigger(selectionBase)

    if (
      shouldArmPartitionLatchFromBlindSpot({
        partitionSignal: connectPartition,
        structuredPingCount: partitionRead.structuredPingCount,
        candidate,
      })
    ) {
      armPartitionLatch(nowMs)
    }

    if (partitionLatchActive(nowMs)) {
      candidate = resolvePartitionLatchCandidate(nowMs, cursorConnectionCount)
    }

    if (!candidate) {
      return
    }

    if (tokenGapSuppressedPendingTool && candidate.trigger === 'token_gap') {
      await appendAppLog(
        formatMtdoLogLine('token_gap', 'skipped_pending_tool', {
          cursor_conn: cursorConnectionCount,
          max_gap_ms: tokenGapSignal?.maxGapMs,
          stale_rids: tokenGapSignal?.staleRequestIds.slice(0, 3).join(','),
        }),
      )
      return
    }

    if (shouldCoalesceMarathonTransportDial(selectionBase, candidate)) {
      if (
        candidate.trigger === 'periodic_session' ||
        candidate.trigger === 'high_latency_warmth'
      ) {
        updateWarmthDeferStreak(cursorConnectionCount, candidate.trigger, 'skipped_deferred')
      }
      await appendAppLog(
        formatMtdoLogLine(candidate.trigger, 'skipped_coalesced', {
          cursor_conn: cursorConnectionCount,
          coalesce_ms: nowMs - lastMtdoDialAtMs,
        }),
      )
      return
    }

    if (!activeNode) {
      await appendAppLog(
        formatMtdoLogLine(candidate.trigger, 'skipped_no_active_node', {
          cursor_conn: cursorConnectionCount,
        }),
      )
      return
    }

    const latchArmedAtMs = getPartitionLatchArmedAtMs()
    const partitionLatchAgeMs =
      candidate.trigger === 'connect_partition' && latchArmedAtMs > 0
        ? nowMs - latchArmedAtMs
        : undefined

    const dialResult = await executeDialPlan(
      candidate,
      cursorConnectionCount,
      nowMs,
      activeNode,
      { partitionLatchAgeMs, breachKinds: rescueContentionBreachKinds },
    )
    updateWarmthDeferStreak(cursorConnectionCount, candidate.trigger, dialResult.outcome)
    const rescueLogOutcome =
      candidate.trigger === 'token_gap' ||
      candidate.trigger === 'silent_generation_end' ||
      candidate.trigger === 'cold_resume'
        ? resolveRescueDialLogOutcome(candidate.trigger, dialResult, {
            maxGapMs: candidate.maxGapMs ?? tokenGapSignal?.maxGapMs,
            staleRequestIdCount: candidate.staleRequestIdCount,
            staleRids: (candidate.staleRequestIds ?? tokenGapSignal?.staleRequestIds ?? [])
              .slice(0, 3)
              .join(','),
          })
        : dialResult.outcome
    if (
      candidate.trigger === 'token_gap' &&
      shouldRecordTokenGapRescueExecution(String(rescueLogOutcome))
    ) {
      const maxGapMs = candidate.maxGapMs ?? tokenGapSignal?.maxGapMs ?? 0
      const staleRequestIds =
        candidate.staleRequestIds ?? tokenGapSignal?.staleRequestIds ?? []
      lastTokenGapRescueRecord = {
        executedAtMs: nowMs,
        outcome: String(rescueLogOutcome),
        maxGapMs,
        staleRequestIds,
        partitionStale: lastConnectPathPartitionStale,
      }
      if (rescueLogOutcome === 'attempted_on_stale_rid') {
        const { recordRecoveryHonestyAttempt } = await import('./mihomoQuicSilentStallRecovery')
        recordRecoveryHonestyAttempt({
          kind: 'token_gap_rescue',
          attemptedAtMs: nowMs,
          baselineMaxGapMs: maxGapMs,
          staleRequestIds,
        })
      }
    }
    if (
      candidate.trigger === 'connect_partition' &&
      shouldRecordConnectPartitionRescueExecution(dialResult.outcome)
    ) {
      lastConnectPartitionRescueRecord = {
        executedAtMs: nowMs,
        outcome: dialResult.outcome,
        staleRequestIds:
          candidate.staleRequestIds ?? connectPartition?.sampleRequestIds ?? [],
        pingFailureCountAtRescue: connectPartition?.pingFailureCount ?? 0,
        connectPathPartitionStale: lastConnectPathPartitionStale,
      }
    }
    if (candidate.trigger === 'connect_partition' && dialResult.outcome === 'executed') {
      clearPartitionLatch()
    }
    if (candidate.trigger === 'connect_partition' && connectPartition) {
      await appendNetworkStabilityEvent({
        ts: new Date().toISOString(),
        kind: 'transport_partition_stale_connect',
        probe_ok: true,
        recovery_action: 'none',
        hung_connection_count: cursorConnectionCount,
        error_detail:
          `connect_ping_failures=${connectPartition.pingFailureCount}` +
          ` window_ms=${connectPartition.windowMs}` +
          ` source=${connectPartition.source}`,
      })
    }
    lastMtdoDialAtMs = nowMs
    void ensureCursorMarathonKeepAlive()
  } catch (error) {
    await appendAppLog(
      `[MarathonTransportDial]: outcome=failed err=${formatUnknownErrorForLog(error)}\n`,
    )
  }
}
