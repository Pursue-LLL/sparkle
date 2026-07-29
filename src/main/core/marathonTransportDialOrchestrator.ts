// [INPUT] MTDO core · stream registry · HY2 keepalive · connect keepalive probes
// [OUTPUT] runMarathonTransportDialCycle · resetMarathonTransportDialOrchestratorForTests
// [POS] MTDO executor: single in-flight hung_scan cycle · independent 60s connect_path pulse · cycle-local pulse reuse (P16).

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
  hasActiveMarathonStream,
  isTokenGapSuppressedForPendingTool,
  type MarathonStreamRegistry,
} from './marathonStreamRegistryCore'
import {
  MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  MTDO_MARATHON_STREAM_MIN_AGE_MS,
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

export interface ConnectPathPulseResult {
  connectPathDelayMs: number
  api2DelayMs: number
  api2directDelayMs: number
  partitionStale: boolean
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
let lastConnectPathPartitionStale = false
let lastLatencyDeltaHigh = false
let consecutiveLatencyDeltaHighCycles = 0
let consecutiveWarmthDeferredCount = 0
let cycleConnectPathPulse: ConnectPathPulseResult | undefined
let lastPartitionBlindSpotAtMs = 0
let lastCursorLogPlaneAtMs = 0

const CURSOR_LOG_PLANE_HEARTBEAT_MS = 60_000

export function resetMarathonTransportDialOrchestratorForTests(): void {
  lastMtdoDialAtMs = 0
  lastConnectPathPulseAtMs = 0
  lastConnectPathPartitionStale = false
  lastLatencyDeltaHigh = false
  consecutiveLatencyDeltaHighCycles = 0
  consecutiveWarmthDeferredCount = 0
  cycleConnectPathPulse = undefined
  lastPartitionBlindSpotAtMs = 0
  lastCursorLogPlaneAtMs = 0
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

async function executeConnectPathPulse(
  activeNode: string,
  cursorConnectionCount: number,
): Promise<ConnectPathPulseResult> {
  if (testConnectPathPulseOverride) {
    return testConnectPathPulseOverride(activeNode, cursorConnectionCount)
  }
  const rescueDelayOptions = { purpose: 'marathon_rescue' as const }
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
  return { connectPathDelayMs, api2DelayMs, api2directDelayMs, partitionStale }
}

async function ensureCycleConnectPathPulse(
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
): Promise<ConnectPathPulseResult> {
  if (cycleConnectPathPulse) {
    return cycleConnectPathPulse
  }
  const pulse = await executeConnectPathPulse(activeNode, cursorConnectionCount)
  cycleConnectPathPulse = pulse
  lastConnectPathPulseAtMs = nowMs
  lastConnectPathPartitionStale = pulse.partitionStale
  return pulse
}

async function runIndependentConnectPathPulseIfDue(
  context: MarathonTransportDialSelectionContext,
  truth: MarathonSSETruthResult,
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
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
    const pulse = await ensureCycleConnectPathPulse(activeNode, cursorConnectionCount, nowMs)
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
  options?: { partitionLatchAgeMs?: number },
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
    await ensureCycleConnectPathPulse(activeNode, cursorConnectionCount, nowMs)
    const sessionResult = await executeMarathonRescueDial(cursorConnectionCount, {
      trigger: candidate.trigger,
      maxGapMs: candidate.maxGapMs,
      staleRequestIdCount: candidate.staleRequestIdCount,
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
    }

    if (activeNode && (marathonTruthPulseDue || marathonTruth.marathonTruthActive)) {
      await runIndependentConnectPathPulseIfDue(
        selectionBase,
        marathonTruth,
        activeNode,
        cursorConnectionCount,
        nowMs,
      )
      selectionBase.lastConnectPathPulseAtMs = lastConnectPathPulseAtMs
      selectionBase.connectPathPartitionDetected = lastConnectPathPartitionStale
    }

    if (activeNode && marathonTruth.marathonTruthActive) {
      const { runHy2TunnelVitalityIfDue } = await import('./hy2TunnelVitality')
      await runHy2TunnelVitalityIfDue(activeNode, cursorConnectionCount, nowMs, marathonTruth)
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
      { partitionLatchAgeMs },
    )
    updateWarmthDeferStreak(cursorConnectionCount, candidate.trigger, dialResult.outcome)
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
