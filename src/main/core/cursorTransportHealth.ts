import axios from 'axios'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { isCoreWithinStartupGrace } from './networkStartupGraceCore'
import { getLastCoreReadyAtMs } from './manager'
import { listCursorConnectionRows } from './cursorConnectionHygiene'
import { runHy2MarathonSessionKeepaliveIfDue } from './cursorHy2MarathonKeepalive'
import { readConnectPartitionSignal } from './connectPartitionReader'
import { ensureCursorMarathonKeepAlive } from './cursorNetworkOptimize'
import { getRecentCursorProbe } from './networkStabilityMonitor'
import { syncMarathonDialToleranceIfNeeded } from './marathonDialTolerance'
import { mihomoCloseConnection, mihomoCloseConnections, mihomoProxyDelay } from './mihomoApi'
import {
  decideRecoveryAction,
  describeRecoveryBlockReason,
  HUNG_SCAN_INTERVAL_MS,
  MANDATORY_REAL_PROBE_MAX_AGE_MS,
  RECOVERY_L0_COOLDOWN_MS,
  RECOVERY_L1_COOLDOWN_MS,
  RECOVERY_L2_COOLDOWN_MS,
  RECOVERY_L3_COOLDOWN_MS,
  resolveProbeAttributionWithConnectPartition,
  selectCriticalHostConnectionsToClose,
  selectHungCursorConnectionsToClose,
  SPLIT_BRAIN_CONTROL_TARGET,
  API2_PROBE_TARGET,
  API2GEO_PROBE_TARGET,
  type ProbeAttribution,
  type ProbePairResult,
  type RecoveryAction,
  type RecoveryCooldownState
} from './cursorTransportHealthCore'
import { shouldForceHy2MarathonSessionKeepaliveForHighLatency } from './cursorHy2MarathonKeepaliveCore'
import {
  readConnectStreamKeepaliveGapSignal,
  readMarathonColdResumeNoTokenSignal,
  readMarathonStreamTokenGapSignal,
} from './cursorStreamTokenGapReader'
import { runConnectStreamKeepaliveIfDue } from './cursorConnectStreamKeepalive'

const PROBE_TIMEOUT_MS = 15_000

async function appendTransportObservabilityEvent(
  event: Omit<import('./networkStabilityMonitor').NetworkStabilityEvent, 'ts'> & {
    ts?: string
  }
): Promise<void> {
  const { appendNetworkStabilityEvent } = await import('./networkStabilityMonitor')
  await appendNetworkStabilityEvent({
    ts: event.ts ?? new Date().toISOString(),
    ...event
  })
}

async function logTransportRecoveryDecision(options: {
  source: 'probe_cycle' | 'hung_scan' | 'tun_lost'
  probe: ProbePairResult
  attribution: ProbeAttribution
  hungIds: string[]
  action: RecoveryAction
  proxyNode?: string
  probeVia?: string
}): Promise<void> {
  const blockReason =
    options.action === 'none'
      ? describeRecoveryBlockReason({
          probe: options.probe,
          attribution: options.attribution,
          hungConnectionIds: options.hungIds,
          tunInterfaceLostConfirmed,
          priorRecoveryFailed,
          cooldowns
        })
      : undefined

  const summary = [
    `source=${options.source}`,
    `attribution=${options.attribution}`,
    `action=${options.action}`,
    `api2_ok=${options.probe.api2Ok}`,
    `api2_latency_ms=${options.probe.api2LatencyMs}`,
    `api2geo_ok=${options.probe.api2geoOk}`,
    `api2geo_latency_ms=${options.probe.api2geoLatencyMs}`,
    `marketplace_ok=${options.probe.marketplaceOk}`,
    `marketplace_latency_ms=${options.probe.marketplaceLatencyMs}`,
    `hung=${options.hungIds.length}`,
    `tun_lost=${tunInterfaceLostConfirmed}`,
    `prior_failed=${priorRecoveryFailed}`,
    options.proxyNode ? `proxy=${options.proxyNode}` : '',
    options.probeVia ? `probe_via=${options.probeVia}` : '',
    blockReason ? `blocked=${blockReason}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  await appendAppLog(`[CursorTransportHealth]: ${summary}\n`)

  const shouldAttachSnapshots = options.source === 'hung_scan' || options.action !== 'none'
  const vpsNodeSnapshots = shouldAttachSnapshots
    ? await (async () => {
        const { collectCanonicalVpsNodeSnapshots } = await import('./canonicalVpsNodeSnapshot')
        return collectCanonicalVpsNodeSnapshots()
      })()
    : undefined

  await appendTransportObservabilityEvent({
    kind: options.source === 'hung_scan' ? 'transport_hung_scan' : 'transport_recovery',
    proxy_node: options.proxyNode,
    probe_target: API2_PROBE_TARGET,
    probe_ok: options.probe.api2Ok,
    probe_latency_ms: options.probe.api2LatencyMs,
    probe_attribution: options.attribution,
    recovery_action: options.action,
    marketplace_ok: options.probe.marketplaceOk,
    marketplace_latency_ms: options.probe.marketplaceLatencyMs,
    hung_connection_count: options.hungIds.length,
    tun_interface_lost_confirmed: tunInterfaceLostConfirmed,
    prior_recovery_failed: priorRecoveryFailed,
    recovery_block_reason: blockReason,
    probe_via: options.probeVia,
    error_detail: summary,
    ...(vpsNodeSnapshots && vpsNodeSnapshots.length > 0
      ? { vps_node_snapshots: vpsNodeSnapshots }
      : {})
  })
}

let hungScanTimer: NodeJS.Timeout | null = null
let lastHungScanHeartbeatAtMs = 0

const HUNG_SCAN_HEARTBEAT_MS = 5 * 60_000
let isHungScanInFlight = false
let priorRecoveryFailed = false
let tunInterfaceLostConfirmed = false

const cooldowns: RecoveryCooldownState = {
  lastL0AtMs: 0,
  lastL1AtMs: 0,
  lastL2AtMs: 0,
  lastL3AtMs: 0
}

export function resetCursorTransportHealthState(): void {
  priorRecoveryFailed = false
  tunInterfaceLostConfirmed = false
  lastHungScanHeartbeatAtMs = 0
  cooldowns.lastL0AtMs = 0
  cooldowns.lastL1AtMs = 0
  cooldowns.lastL2AtMs = 0
  cooldowns.lastL3AtMs = 0
}

export function markTunInterfaceLostConfirmed(): void {
  tunInterfaceLostConfirmed = true
}

export function clearTunInterfaceLostConfirmed(): void {
  tunInterfaceLostConfirmed = false
}

export function getRecoveryCooldownState(): RecoveryCooldownState {
  return { ...cooldowns }
}

async function probeHttpTarget(
  target: string,
  proxy?: { host: string; port: number }
): Promise<{ ok: boolean; latencyMs: number; status?: number; errorDetail?: string }> {
  const startedAt = Date.now()
  try {
    const response = await axios.head(target, {
      ...(proxy
        ? {
            proxy: {
              host: proxy.host,
              port: proxy.port,
              protocol: 'http' as const
            }
          }
        : {}),
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects: 0
    })
    const latencyMs = Date.now() - startedAt
    return {
      ok: response.status > 0 && response.status < 500,
      latencyMs,
      status: response.status
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { message?: string; response?: { status?: number } }
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      status: err.response?.status,
      errorDetail: err.message ?? String(error)
    }
  }
}

export async function runTransportProbePair(options: {
  proxyHost: string
  proxyPort: number
  viaDirectTun?: boolean
}): Promise<ProbePairResult & { api2Status?: number; marketplaceStatus?: number }> {
  const proxy = options.viaDirectTun
    ? undefined
    : { host: options.proxyHost, port: options.proxyPort }
  const [api2, api2geo, marketplace] = await Promise.all([
    probeHttpTarget(API2_PROBE_TARGET, proxy),
    probeHttpTarget(API2GEO_PROBE_TARGET, proxy),
    probeHttpTarget(SPLIT_BRAIN_CONTROL_TARGET, proxy)
  ])
  return {
    api2Ok: api2.ok,
    api2geoOk: api2geo.ok,
    marketplaceOk: marketplace.ok,
    api2LatencyMs: api2.latencyMs,
    api2geoLatencyMs: api2geo.latencyMs,
    marketplaceLatencyMs: marketplace.latencyMs,
    api2Status: api2.status,
    marketplaceStatus: marketplace.status
  }
}

/**
 * Probe api2 through a specific mihomo proxy node (bypasses TUN rule matching).
 * Returns api2 reachability as seen from the given node — use when TUN routing
 * would send the probe through a different node than Cursor actually uses.
 */
export async function probeApi2ViaMihomoNode(
  proxyNode: string
): Promise<{ ok: boolean; latencyMs: number; errorDetail?: string }> {
  return probeCursorHostViaMihomoNode(proxyNode, API2_PROBE_TARGET)
}

export async function probeApi2geoViaMihomoNode(
  proxyNode: string
): Promise<{ ok: boolean; latencyMs: number; errorDetail?: string }> {
  return probeCursorHostViaMihomoNode(proxyNode, API2GEO_PROBE_TARGET)
}

async function probeCursorHostViaMihomoNode(
  proxyNode: string,
  target: string
): Promise<{ ok: boolean; latencyMs: number; errorDetail?: string }> {
  const startedAt = Date.now()
  try {
    const result = await mihomoProxyDelay(proxyNode, target)
    const latencyMs = Date.now() - startedAt
    if (typeof result.delay === 'number' && result.delay > 0) {
      return { ok: true, latencyMs: result.delay }
    }
    return {
      ok: false,
      latencyMs,
      errorDetail: (result as { message?: string }).message
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorDetail: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Run transport probe pair with api2 routed through a specific Cursor proxy node
 * instead of the default TUN/mixed-port path. Marketplace probe still goes via
 * the normal path (split-brain control).
 */
export async function runTransportProbePairViaCursorNode(
  cursorProxyNode: string,
  fallbackOptions: {
    proxyHost: string
    proxyPort: number
    viaDirectTun?: boolean
  }
): Promise<ProbePairResult & { api2Status?: number; marketplaceStatus?: number; api2ViaNode: true }> {
  const marketplaceProxy = fallbackOptions.viaDirectTun
    ? undefined
    : { host: fallbackOptions.proxyHost, port: fallbackOptions.proxyPort }
  const [api2, api2geo, marketplace] = await Promise.all([
    probeApi2ViaMihomoNode(cursorProxyNode),
    probeApi2geoViaMihomoNode(cursorProxyNode),
    probeHttpTarget(SPLIT_BRAIN_CONTROL_TARGET, marketplaceProxy)
  ])
  return {
    api2Ok: api2.ok,
    api2geoOk: api2geo.ok,
    marketplaceOk: marketplace.ok,
    api2LatencyMs: api2.latencyMs,
    api2geoLatencyMs: api2geo.latencyMs,
    marketplaceLatencyMs: marketplace.latencyMs,
    marketplaceStatus: marketplace.status,
    api2ViaNode: true
  }
}

export function resolveTransportProbeAttribution(
  probe: ProbePairResult,
  connectPartition?: import('./connectPartitionDetectCore').ConnectPartitionSignal,
): ProbeAttribution {
  return resolveProbeAttributionWithConnectPartition(probe, connectPartition)
}

async function executeRecoveryL0(hungIds: string[]): Promise<number> {
  let closed = 0
  for (const id of hungIds) {
    try {
      await mihomoCloseConnection(id)
      closed += 1
    } catch {
      // ignore single close errors
    }
  }
  cooldowns.lastL0AtMs = Date.now()
  if (closed > 0) {
    await appendAppLog(`[CursorTransportHealth]: L0 closed ${closed} hung Cursor connection(s)\n`)
  }
  return closed
}

async function executeRecoveryL1(rows: Awaited<ReturnType<typeof listCursorConnectionRows>>): Promise<number> {
  const ids = selectCriticalHostConnectionsToClose(rows)
  let closed = 0
  for (const id of ids) {
    try {
      await mihomoCloseConnection(id)
      closed += 1
    } catch {
      // ignore
    }
  }
  cooldowns.lastL1AtMs = Date.now()
  if (closed > 0) {
    await appendAppLog(
      `[CursorTransportHealth]: L1 closed ${closed} critical-host Cursor connection(s) (transport_partition_stale)\n`
    )
  }
  return closed
}

async function executeRecoveryL2(): Promise<void> {
  await mihomoCloseConnections()
  cooldowns.lastL2AtMs = Date.now()
  await appendAppLog('[CursorTransportHealth]: L2 flushed all mihomo outbound connections\n')
}

async function executeRecoveryL3(): Promise<void> {
  if (isCoreWithinStartupGrace(getLastCoreReadyAtMs())) {
    await appendAppLog('[CursorTransportHealth]: defer L3 restartCore — core startup grace\n')
    return
  }
  cooldowns.lastL3AtMs = Date.now()
  await appendAppLog('[CursorTransportHealth]: L3 restarting mihomo core after recovery ladder exhaustion\n')
  await showNotification({
    id: 'sparkle-transport-health-l3',
    title: 'Sparkle: 传输层恢复',
    body: '挂死连接清理后 api2 仍不可用，正在重启 core…',
    variant: 'warning'
  })
  const { restartCore } = await import('./manager')
  await restartCore()
  priorRecoveryFailed = false
  tunInterfaceLostConfirmed = false
}

export async function executeTransportRecovery(action: RecoveryAction): Promise<void> {
  if (action === 'none') {
    return
  }

  const rows = await listCursorConnectionRows()
  const hungIds = selectHungCursorConnectionsToClose(rows)

  if (action === 'L0') {
    const closed = await executeRecoveryL0(hungIds)
    priorRecoveryFailed = closed === 0
    return
  }

  if (action === 'L1') {
    const closed = await executeRecoveryL1(rows)
    priorRecoveryFailed = closed === 0
    return
  }

  if (action === 'L2') {
    await executeRecoveryL2()
    priorRecoveryFailed = true
    return
  }

  if (action === 'L3') {
    await executeRecoveryL3()
  }
}

export async function evaluateAndRecoverTransport(
  probe: ProbePairResult,
  attribution: ProbeAttribution,
  options: { source?: 'probe_cycle' | 'tun_lost'; proxyNode?: string; probeVia?: string } = {}
): Promise<RecoveryAction> {
  const rows = await listCursorConnectionRows()
  const hungIds = selectHungCursorConnectionsToClose(rows)
  const action = decideRecoveryAction({
    probe,
    attribution,
    hungConnectionIds: hungIds,
    tunInterfaceLostConfirmed,
    priorRecoveryFailed,
    cooldowns
  })

  if (attribution !== 'healthy' || hungIds.length > 0) {
    await logTransportRecoveryDecision({
      source: options.source ?? 'probe_cycle',
      probe,
      attribution,
      hungIds,
      action,
      proxyNode: options.proxyNode,
      probeVia: options.probeVia
    })
  }

  if (action !== 'none') {
    await executeTransportRecovery(action)
  } else if (attribution === 'healthy') {
    priorRecoveryFailed = false
    tunInterfaceLostConfirmed = false
  }

  return action
}

/** Proactive HY2/TUIC warmth: connect-partition · cold-resume · token-gap · high-latency · periodic nudge. */
export async function runMarathonSessionWarmthIfDue(cursorConnectionCount: number): Promise<void> {
  const { ensureMihomoApiReachableForMarathon } = await import('./mihomoApiSocketWatchdog')
  await ensureMihomoApiReachableForMarathon('warmth_precheck')

  const connectPartition = readConnectPartitionSignal(cursorConnectionCount)
  const coldResumeSignal = await readMarathonColdResumeNoTokenSignal(cursorConnectionCount)
  const connectStreamGapSignal = await readConnectStreamKeepaliveGapSignal(cursorConnectionCount)
  const tokenGapSignal = await readMarathonStreamTokenGapSignal(cursorConnectionCount)
  void runConnectStreamKeepaliveIfDue(cursorConnectionCount, connectStreamGapSignal)
  const recentProbe = getRecentCursorProbe()
  const highLatencyMs = recentProbe?.latencyMs ?? 0
  const forceHighLatencyNudge = shouldForceHy2MarathonSessionKeepaliveForHighLatency(
    cursorConnectionCount,
    highLatencyMs,
  )
  if (connectPartition) {
    await runHy2MarathonSessionKeepaliveIfDue(cursorConnectionCount, { force: true })
    void ensureCursorMarathonKeepAlive()
    await appendTransportObservabilityEvent({
      kind: 'transport_partition_stale_connect',
      probe_ok: true,
      recovery_action: 'none',
      hung_connection_count: cursorConnectionCount,
      error_detail: `connect_ping_failures=${connectPartition.pingFailureCount} window_ms=${connectPartition.windowMs} sample_rids=${connectPartition.sampleRequestIds.join(',')}`,
    })
    return
  }
  if (coldResumeSignal) {
    await runHy2MarathonSessionKeepaliveIfDue(cursorConnectionCount, { tokenGapForce: true })
    void ensureCursorMarathonKeepAlive()
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: cold_resume_no_token_nudge cursor_conn=${cursorConnectionCount} max_gap_ms=${coldResumeSignal.maxGapMs} stale_rids=${coldResumeSignal.staleRequestIds.slice(0, 3).join(',')}\n`,
    )
    return
  }
  if (tokenGapSignal) {
    await runHy2MarathonSessionKeepaliveIfDue(cursorConnectionCount, { tokenGapForce: true })
    void ensureCursorMarathonKeepAlive()
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: token_gap_force_nudge cursor_conn=${cursorConnectionCount} max_gap_ms=${tokenGapSignal.maxGapMs} stale_rids=${tokenGapSignal.staleRequestIds.slice(0, 3).join(',')}\n`,
    )
    return
  }
  if (forceHighLatencyNudge) {
    await runHy2MarathonSessionKeepaliveIfDue(cursorConnectionCount, { highLatencyForce: true })
    void ensureCursorMarathonKeepAlive()
    await appendAppLog(
      `[CursorHy2MarathonKeepalive]: high_latency_force_nudge cursor_conn=${cursorConnectionCount} api2_delay_ms=${highLatencyMs}\n`,
    )
    return
  }
  void runHy2MarathonSessionKeepaliveIfDue(cursorConnectionCount)
}

async function runHungConnectionScanCycle(): Promise<void> {
  if (isHungScanInFlight) {
    return
  }
  isHungScanInFlight = true
  try {
    const rows = await listCursorConnectionRows()
    void syncMarathonDialToleranceIfNeeded(rows.length)
    const { syncAgentTransportFailuresFromCursorLogs } = await import('./agentTransportFailureSync')
    const { resolveCursorDedicatedActiveNode } = await import('./cursorHy2MarathonKeepalive')
    const activeNode = await resolveCursorDedicatedActiveNode()
    await syncAgentTransportFailuresFromCursorLogs({ proxyNodeFallback: activeNode })
    await runMarathonSessionWarmthIfDue(rows.length)
    const hungIds = selectHungCursorConnectionsToClose(rows)
    if (hungIds.length === 0) {
      const nowMs = Date.now()
      if (
        rows.length > 0 &&
        nowMs - lastHungScanHeartbeatAtMs >= HUNG_SCAN_HEARTBEAT_MS
      ) {
        lastHungScanHeartbeatAtMs = nowMs
        await appendAppLog(
          `[CursorTransportHealth]: hung_scan_heartbeat cursor_connections=${rows.length} hung=0\n`
        )
        await appendTransportObservabilityEvent({
          kind: 'transport_hung_scan',
          probe_ok: true,
          recovery_action: 'none',
          hung_connection_count: 0,
          error_detail: `heartbeat cursor_connections=${rows.length}`
        })
      }
      return
    }
    const recentProbeForHung = getRecentCursorProbe(MANDATORY_REAL_PROBE_MAX_AGE_MS)
    const probe: ProbePairResult = recentProbeForHung
      ? {
          api2Ok: recentProbeForHung.ok,
          api2geoOk: recentProbeForHung.ok,
          marketplaceOk: true,
          api2LatencyMs: recentProbeForHung.latencyMs ?? 0,
          api2geoLatencyMs: recentProbeForHung.latencyMs ?? 0,
          marketplaceLatencyMs: 0
        }
      : {
          api2Ok: false,
          api2geoOk: false,
          marketplaceOk: false,
          api2LatencyMs: 0,
          api2geoLatencyMs: 0,
          marketplaceLatencyMs: 0
        }
    const attribution = resolveTransportProbeAttribution(probe, connectPartition)
    const action = decideRecoveryAction({
      probe,
      attribution,
      hungConnectionIds: hungIds,
      tunInterfaceLostConfirmed,
      priorRecoveryFailed,
      cooldowns
    })
    await logTransportRecoveryDecision({
      source: 'hung_scan',
      probe,
      attribution,
      hungIds,
      action,
      proxyNode: recentProbe?.proxyNode
    })
    if (action === 'L0') {
      await executeTransportRecovery('L0')
    }
  } catch (error) {
    await appendAppLog(
      `[CursorTransportHealth]: hung scan failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    isHungScanInFlight = false
  }
}

export function startCursorTransportHealth(): void {
  stopCursorTransportHealth()
  resetCursorTransportHealthState()
  void runHungConnectionScanCycle()
  hungScanTimer = setInterval(() => {
    void runHungConnectionScanCycle()
  }, HUNG_SCAN_INTERVAL_MS)
}

export function stopCursorTransportHealth(): void {
  if (hungScanTimer) {
    clearInterval(hungScanTimer)
    hungScanTimer = null
  }
  isHungScanInFlight = false
}

export function getRecoveryCooldownSummary(): string {
  return `L0=${RECOVERY_L0_COOLDOWN_MS}ms L1=${RECOVERY_L1_COOLDOWN_MS}ms L2=${RECOVERY_L2_COOLDOWN_MS}ms L3=${RECOVERY_L3_COOLDOWN_MS}ms`
}
