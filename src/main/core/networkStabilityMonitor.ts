import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { net } from 'electron'
import path from 'path'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { homeDir } from '../utils/dirs'
import { ensureCursorMarathonKeepAlive } from './cursorNetworkOptimize'
import { resolveCursorStableSelectorGroup } from './cursorProxyGroup'
import {
  evaluateNetworkProbeAlert,
  handleNetworkOfflineAlert,
  resetNetworkAlertState
} from './networkAlertNotifier'
import { shouldSkipCommercialBenchmarkDuringBurst } from './networkBurstGateCore'
import { isCoreWithinStartupGrace } from './networkStartupGraceCore'
import { getLastCoreReadyAtMs } from './manager'
import { countCursorConnections, startCursorConnectionHygiene, stopCursorConnectionHygiene } from './cursorConnectionHygiene'
import {
  shouldDeferProbeForCursorLoad,
  shouldDeferDestructiveRecoveryAfterLiveProbe,
  type MandatoryProbeContext,
  type ProbeAttribution
} from './cursorTransportHealthCore'
import {
  clearTunInterfaceLostConfirmed,
  evaluateAndRecoverTransport,
  markTunInterfaceLostConfirmed,
  resetCursorTransportHealthState,
  runTransportProbePair,
  resolveTransportProbeAttribution,
  startCursorTransportHealth,
  stopCursorTransportHealth
} from './cursorTransportHealth'
import { appendAppLog, getCachedMihomoLogs } from '../utils/log'
import { recordActiveApi2ProbeToLedger } from './api2ProbeActiveRecord'
import { isApi2ProbePlaneActive } from './api2ProbePlaneCore'
import { watchTunStartupLogLine } from './tunStartupGuard'

const PROBE_TARGET = 'https://api2.cursor.sh'
const PROBE_INTERVAL_MS = 60_000
const BURST_PROBE_INTERVAL_MS = 30_000
const BURST_DURATION_MS = 5 * 60_000
const BURST_FAILURE_THRESHOLD = 2
const DEFER_PROBE_LOG_COOLDOWN_MS = 5 * 60_000
const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Wait before recovery — filters transient TUN monitor glitches during route churn. */
const TUN_LOST_DEBOUNCE_MS = 8_000
const TUN_INTERFACE_LOST_RE = /\[TUN\] default interface lost by monitor/
const EVENTS_DIR = path.join(homeDir, '.sparkle')
const EVENTS_PATH = path.join(EVENTS_DIR, 'network-stability-events.jsonl')

type NetworkStabilityKind =
  | 'probe'
  | 'proxy_switch'
  | 'offline'
  | 'online'
  | 'tun_interface_lost'
  | 'tun_interface_recovered'
  | 'transport_recovery'
  | 'transport_hung_scan'

export interface NetworkStabilityEvent {
  ts: string
  kind: NetworkStabilityKind
  proxy_node?: string
  proxy_delay_ms?: number
  probe_target?: string
  probe_via?: string
  probe_ok?: boolean
  probe_status?: number
  probe_latency_ms?: number
  probe_target_kind?: 'api2_short'
  probe_authoritative?: boolean
  probe_attribution?: ProbeAttribution
  recovery_action?: string
  marketplace_ok?: boolean
  marketplace_latency_ms?: number
  hung_connection_count?: number
  tun_interface_lost_confirmed?: boolean
  prior_recovery_failed?: boolean
  recovery_block_reason?: string
  error_code?: string
  error_detail?: string
  from_proxy?: string
  to_proxy?: string
}

export async function appendNetworkStabilityEvent(event: NetworkStabilityEvent): Promise<void> {
  await appendEvent(event)
}

let probeTimer: NodeJS.Timeout | null = null
let isMonitoring = false
let isProbing = false
let shortProbeFailures = 0
let burstUntil = 0
let appendCount = 0
let writeQueue: Promise<void> = Promise.resolve()
let wasOffline = false
let lastCursorProbe: {
  ok: boolean
  atMs: number
  proxyNode?: string
  latencyMs?: number
} | null = null
let lastTunWatchSeq = 0
let tunInterfaceLostLatched = false
let tunRecoverInFlight = false
let tunLostDebounceTimer: NodeJS.Timeout | null = null
let tunLostSignalCount = 0
let lastDeferProbeLogAt = 0
let lastRealProbeAtMs = 0
let lastTransportAttribution: ProbeAttribution | null = null

export function getLastTransportProbeAttribution(): ProbeAttribution | null {
  return lastTransportAttribution
}

const RECENT_PROBE_MAX_AGE_MS = 90_000

function activateBurstProbeMode(nowMs: number, failures: number): void {
  const wasActive = nowMs < burstUntil
  burstUntil = nowMs + BURST_DURATION_MS
  if (!wasActive) {
    void appendAppLog(
      `[NetworkStabilityMonitor]: burst probe active (failures=${failures}, until=${new Date(burstUntil).toISOString()})\n`
    )
  }
}

async function logDeferredProbeIfDue(cursorConnCount: number): Promise<void> {
  const nowMs = Date.now()
  if (nowMs - lastDeferProbeLogAt < DEFER_PROBE_LOG_COOLDOWN_MS) {
    return
  }
  lastDeferProbeLogAt = nowMs
  const recent = getRecentCursorProbe()
  const latencyPart =
    recent?.latencyMs !== undefined ? `cached_latency=${recent.latencyMs}ms` : 'cached_latency=none'
  await appendAppLog(
    `[NetworkStabilityMonitor]: defer api2 HEAD (cursor_conn=${cursorConnCount}, ${latencyPart})\n`
  )
}

function getPrimaryProxyGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  return resolveCursorStableSelectorGroup(groups)
}

function getNextProbeDelayMs(): number {
  if (Date.now() < burstUntil) {
    return BURST_PROBE_INTERVAL_MS
  }
  return PROBE_INTERVAL_MS
}


export function getNetworkMonitorNextProbeDelayMs(): number {
  return getNextProbeDelayMs()
}

async function ensureEventsDir(): Promise<void> {
  await mkdir(EVENTS_DIR, { recursive: true })
}

async function pruneEventsFile(): Promise<void> {
  try {
    const raw = await readFile(EVENTS_PATH, 'utf8')
    if (!raw) return

    const cutoff = Date.now() - RETENTION_MS
    const kept = raw
      .split('\n')
      .filter((line) => {
        if (!line.trim()) return false
        try {
          const parsed = JSON.parse(line) as NetworkStabilityEvent
          const ts = Date.parse(parsed.ts)
          return Number.isFinite(ts) && ts >= cutoff
        } catch {
          return false
        }
      })

    const nextContent = kept.length > 0 ? `${kept.join('\n')}\n` : ''
    await writeFile(EVENTS_PATH, nextContent, 'utf8')
  } catch {
    // Non-fatal: probing must continue even if rotation fails.
  }
}

async function appendEvent(event: NetworkStabilityEvent): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureEventsDir()
    await appendFile(EVENTS_PATH, `${JSON.stringify(event)}\n`, 'utf8')
    appendCount += 1
    if (appendCount % 100 === 0) {
      try {
        const { stat } = await import('fs/promises')
        const fileStat = await stat(EVENTS_PATH)
        if (fileStat.size >= MAX_FILE_BYTES) {
          await pruneEventsFile()
        }
      } catch {
        // ignore rotation errors
      }
    }
  })
  await writeQueue
}

async function getProxyEndpoint(): Promise<{ host: string; port: number }> {
  const { sysProxy } = await getAppConfig()
  const { 'mixed-port': port = 7890 } = await getControledMihomoConfig()
  return { host: sysProxy.host || '127.0.0.1', port }
}

async function shouldProbeViaDirectTun(): Promise<boolean> {
  const { sysProxy } = await getAppConfig()
  const { tun } = await getControledMihomoConfig()
  return tun?.enable === true && sysProxy?.enable !== true
}

async function resolveCurrentProxyNode(): Promise<string | undefined> {
  const { mihomoGroups } = await import('./mihomoApi')
  const groups = await mihomoGroups()
  if (!groups || groups.length === 0) return undefined
  const primaryGroup = getPrimaryProxyGroup(groups)
  return primaryGroup?.now
}

async function resolveProbeTransportOptions(): Promise<{
  proxyHost: string
  proxyPort: number
  viaDirectTun: boolean
}> {
  const { host, port } = await getProxyEndpoint()
  const viaDirectTun = await shouldProbeViaDirectTun()
  return { proxyHost: host, proxyPort: port, viaDirectTun }
}

function buildMandatoryProbeContext(
  cursorConnCount: number,
  hungConnectionCount: number
): MandatoryProbeContext {
  return {
    cursorConnectionCount: cursorConnCount,
    lastRealProbeAtMs,
    hungConnectionCount,
    tunInterfaceLostLatched,
    burstProbeActive: Date.now() < burstUntil
  }
}

async function countHungCursorConnections(): Promise<number> {
  const { listCursorConnectionRows } = await import('./cursorConnectionHygiene')
  const { selectHungCursorConnectionsToClose } = await import('./cursorTransportHealthCore')
  const rows = await listCursorConnectionRows()
  return selectHungCursorConnectionsToClose(rows).length
}

function logPayloadText(payload: ControllerLog['payload']): string {
  if (typeof payload === 'string') {
    return payload
  }
  if (payload === undefined || payload === null) {
    return ''
  }
  return String(payload)
}

function clearTunLostDebounceTimer(): void {
  if (tunLostDebounceTimer) {
    clearTimeout(tunLostDebounceTimer)
    tunLostDebounceTimer = null
  }
}

async function shouldDeferTunCoreRestart(): Promise<boolean> {
  const proxyNode = await resolveCurrentProxyNode()
  if (!proxyNode) {
    return false
  }
  const probe = await runTransportProbePair(await resolveProbeTransportOptions())
  lastRealProbeAtMs = Date.now()
  lastCursorProbe = {
    ok: probe.api2Ok,
    atMs: lastRealProbeAtMs,
    proxyNode,
    latencyMs: probe.api2LatencyMs > 0 ? probe.api2LatencyMs : undefined
  }
  return shouldDeferDestructiveRecoveryAfterLiveProbe(probe.api2Ok, proxyNode, proxyNode)
}

async function confirmTunInterfaceLostAfterDebounce(): Promise<void> {
  tunLostDebounceTimer = null
  const signalCount = tunLostSignalCount
  tunLostSignalCount = 0

  if (await shouldDeferTunCoreRestart()) {
    await appendAppLog(
      `[NetworkStabilityMonitor]: defer TUN restart (signals=${signalCount}) — Cursor api2 reachable on current node\n`
    )
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: `tun lost signals=${signalCount} — cursor api2 ok, skip restartCore`
    })
    tunInterfaceLostLatched = false
    return
  }

  const api2Ok = await runCursorApiProbeCheck()
  lastRealProbeAtMs = Date.now()
  if (api2Ok) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: TUN lost debounced — api2 still reachable after grace window, skip recovery\n'
    )
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: 'debounced tun lost — api2 reachable, no transport recovery'
    })
    tunInterfaceLostLatched = false
    return
  }

  markTunInterfaceLostConfirmed()
  await handleTunInterfaceLost()
}

async function scheduleTunInterfaceLostRecovery(): Promise<void> {
  if (tunLostDebounceTimer) {
    tunLostSignalCount += 1
    clearTunLostDebounceTimer()
    tunLostDebounceTimer = setTimeout(() => {
      void confirmTunInterfaceLostAfterDebounce()
    }, 500)
    return
  }

  if (tunInterfaceLostLatched) {
    return
  }

  tunInterfaceLostLatched = true
  tunLostSignalCount = 1
  await appendEvent({
    ts: new Date().toISOString(),
    kind: 'tun_interface_lost',
    error_code: 'TUN_INTERFACE_LOST',
    error_detail: 'mihomo TUN default interface lost by monitor (debounce pending)'
  })

  tunLostDebounceTimer = setTimeout(() => {
    void confirmTunInterfaceLostAfterDebounce()
  }, TUN_LOST_DEBOUNCE_MS)
}

async function handleTunInterfaceLost(): Promise<void> {
  clearTunLostDebounceTimer()
  tunLostSignalCount = 0

  const now = Date.now()
  if (tunRecoverInFlight) {
    return
  }

  if (isCoreWithinStartupGrace(getLastCoreReadyAtMs(), undefined, now)) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: defer TUN recovery — core still within startup grace window\n'
    )
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: 'tun lost during core startup grace — skip transport recovery'
    })
    tunInterfaceLostLatched = false
    clearTunInterfaceLostConfirmed()
    return
  }

  const transport = await resolveProbeTransportOptions()
  const probe = await runTransportProbePair(transport)
  lastRealProbeAtMs = Date.now()
  const attribution = resolveTransportProbeAttribution(probe)
  const proxyNode = await resolveCurrentProxyNode()
  lastCursorProbe = {
    ok: probe.api2Ok,
    atMs: lastRealProbeAtMs,
    proxyNode,
    latencyMs: probe.api2LatencyMs > 0 ? probe.api2LatencyMs : undefined
  }

  if (shouldDeferDestructiveRecoveryAfterLiveProbe(probe.api2Ok, proxyNode ?? '', proxyNode)) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: defer TUN recovery — live api2 probe ok on current node\n'
    )
    tunInterfaceLostLatched = false
    clearTunInterfaceLostConfirmed()
    return
  }

  await appendEvent({
    ts: new Date().toISOString(),
    kind: 'tun_interface_lost',
    error_code: 'TUN_INTERFACE_LOST_CONFIRMED',
    error_detail: 'mihomo TUN default interface lost — executing transport recovery ladder',
    probe_attribution: attribution
  })

  tunRecoverInFlight = true
  try {
    const recoveryAction = await evaluateAndRecoverTransport(probe, attribution, {
      source: 'tun_lost',
      proxyNode: await resolveCurrentProxyNode()
    })
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: `transport recovery after tun lost (${recoveryAction})`,
      recovery_action: recoveryAction,
      probe_attribution: attribution
    })
    if (recoveryAction === 'L3') {
      activateBurstProbeMode(now, 0)
    }
    tunInterfaceLostLatched = false
    clearTunInterfaceLostConfirmed()
  } catch (error) {
    await appendAppLog(
      `[NetworkStabilityMonitor]: TUN recovery failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    tunRecoverInFlight = false
  }
}

async function scanTunLogEvents(): Promise<void> {
  const logs = getCachedMihomoLogs()
  const fresh = logs.filter((entry) => entry.seq > lastTunWatchSeq)
  if (fresh.length === 0) {
    return
  }
  lastTunWatchSeq = Math.max(...fresh.map((entry) => entry.seq))

  let interfaceLost = false
  for (const entry of fresh) {
    const msg = logPayloadText(entry.payload)
    watchTunStartupLogLine(msg)
    if (TUN_INTERFACE_LOST_RE.test(msg)) {
      interfaceLost = true
      break
    }
  }

  if (interfaceLost) {
    await scheduleTunInterfaceLostRecovery()
  }
}

function seedTunLogWatchCursor(): void {
  const logs = getCachedMihomoLogs()
  lastTunWatchSeq = logs.length > 0 ? Math.max(...logs.map((entry) => entry.seq)) : 0
  tunInterfaceLostLatched = false
  tunRecoverInFlight = false
  clearTunLostDebounceTimer()
  tunLostSignalCount = 0
}

async function runProbeCycle(): Promise<number> {
  if (!isMonitoring || isProbing) {
    return getNextProbeDelayMs()
  }

  isProbing = true
  try {
    const ts = new Date().toISOString()
    const online = net.isOnline()

    if (!online) {
      if (!wasOffline) {
        await appendEvent({ ts, kind: 'offline' })
        wasOffline = true
        void handleNetworkOfflineAlert()
      }
      shortProbeFailures += 1
      if (shortProbeFailures >= BURST_FAILURE_THRESHOLD) {
        activateBurstProbeMode(Date.now(), shortProbeFailures)
      }
      return getNextProbeDelayMs()
    }

    if (wasOffline) {
      await appendEvent({ ts, kind: 'online' })
      wasOffline = false
      burstUntil = 0
      shortProbeFailures = 0
    }

    await scanTunLogEvents()

    const cursorConnCount = await countCursorConnections().catch(() => 0)
    const hungCount = await countHungCursorConnections().catch(() => 0)
    const mandatoryContext = buildMandatoryProbeContext(cursorConnCount, hungCount)
    if (shouldDeferProbeForCursorLoad(cursorConnCount, mandatoryContext)) {
      await appendDeferredProbeCacheEvent(cursorConnCount)
      await logDeferredProbeIfDue(cursorConnCount)
      return getNextProbeDelayMs()
    }

    void ensureCursorMarathonKeepAlive()

    const connectivityOk = await runCursorTransportConnectivityCheck({ notify: true })
    if (connectivityOk) {
      shortProbeFailures = 0
      if (!tunInterfaceLostLatched) {
        burstUntil = 0
      }
      if (tunInterfaceLostLatched) {
        tunInterfaceLostLatched = false
      }
    } else {
      shortProbeFailures += 1
      if (shortProbeFailures >= BURST_FAILURE_THRESHOLD) {
        activateBurstProbeMode(Date.now(), shortProbeFailures)
      }
    }
  } catch {
    shortProbeFailures += 1
    if (shortProbeFailures >= BURST_FAILURE_THRESHOLD) {
      activateBurstProbeMode(Date.now(), shortProbeFailures)
    }
  } finally {
    isProbing = false
  }
  return getNextProbeDelayMs()
}

/** Active-path monitor tick — scheduled exclusively by api2ProbePlane. */
export async function runNetworkMonitorCycle(): Promise<number> {
  return runProbeCycle()
}

export function getNetworkBurstUntilMs(): number {
  return burstUntil
}

/** True while api2 active transport_pair cycle is in flight. */
export function isNetworkStabilityShortProbeActive(): boolean {
  return isProbing || isApi2ProbePlaneActive()
}

export function isNetworkStabilityBurstActive(nowMs: number = Date.now()): boolean {
  return shouldSkipCommercialBenchmarkDuringBurst(burstUntil, nowMs)
}

interface CursorShortConnectivityOptions {
  /** When true, drive networkAlertEnabled notifications (60s monitor). */
  notify?: boolean
}

async function appendLiveTransportProbeToLedger(
  probe: Awaited<ReturnType<typeof runTransportProbePair>>,
  method: 'on_demand' | 'defer_check',
  options?: { probeVia?: string; recoveryAction?: string; errorDetail?: string }
): Promise<void> {
  const attribution = resolveTransportProbeAttribution(probe)
  lastTransportAttribution = attribution
  const proxyNode = (await resolveCurrentProxyNode()) ?? ''
  await recordActiveApi2ProbeToLedger({
    method,
    authoritative: method === 'defer_check',
    probe,
    proxyNode,
    attribution,
    ...(options?.probeVia ? { probeVia: options.probeVia } : {}),
    ...(options?.recoveryAction ? { recoveryAction: options.recoveryAction } : {}),
    ...(options?.errorDetail ? { errorDetail: options.errorDetail } : {})
  })
}

async function appendDeferredProbeCacheEvent(cursorConnCount: number): Promise<void> {
  const recent = getRecentCursorProbe()
  const { appendApi2ProbeLedgerRow } = await import('./api2ProbeLedgerCore')
  await appendApi2ProbeLedgerRow({
    ts: new Date().toISOString(),
    scope: 'active',
    node: recent?.proxyNode ?? '',
    latency_ms: recent?.latencyMs ?? -1,
    ok: recent?.ok === true,
    authoritative: false,
    method: 'deferred',
    probe_attribution: 'deferred_load',
    probe_via: 'deferred_load',
    error_detail: `deferred: cursor_connections=${cursorConnCount}`
  })
}

/** HTTP api2 + marketplace probe via current proxy — authoritative transport health signal. */
async function runCursorTransportConnectivityCheck(
  options: CursorShortConnectivityOptions = {}
): Promise<boolean> {
  const transport = await resolveProbeTransportOptions()
  const proxyNode = await resolveCurrentProxyNode()
  const probe = await runTransportProbePair(transport)
  const attribution = resolveTransportProbeAttribution(probe)
  lastTransportAttribution = attribution
  lastRealProbeAtMs = Date.now()
  const proxyDelayMs = probe.api2LatencyMs > 0 ? probe.api2LatencyMs : undefined
  lastCursorProbe = {
    ok: probe.api2Ok,
    atMs: lastRealProbeAtMs,
    proxyNode,
    latencyMs: proxyDelayMs
  }

  let recoveryAction = 'none'
  if (attribution === 'transport_partition_stale' || attribution === 'node_degraded') {
    recoveryAction = await evaluateAndRecoverTransport(probe, attribution, {
      source: 'probe_cycle',
      proxyNode
    })
  }

  await recordActiveApi2ProbeToLedger({
    method: 'transport_pair',
    authoritative: true,
    probe,
    proxyNode: proxyNode ?? '',
    attribution,
    probeVia: transport.viaDirectTun ? 'tun' : 'mixed_port',
    proxyDelayMs,
    recoveryAction,
    errorDetail: `target=${PROBE_TARGET} marketplace_ok=${probe.marketplaceOk} marketplace_latency_ms=${probe.marketplaceLatencyMs} recovery=${recoveryAction}`
  })

  if (options.notify) {
    void evaluateNetworkProbeAlert({
      proxyNode,
      proxyDelayMs,
      probeOk: probe.api2Ok,
      probeLatencyMs: probe.api2LatencyMs,
      errorDetail: attribution
    })
  }
  return probe.api2Ok
}

/** @deprecated Use runCursorTransportConnectivityCheck — kept for internal probe-only callers. */
async function runCursorShortConnectivityCheck(
  options: CursorShortConnectivityOptions = {}
): Promise<boolean> {
  return runCursorTransportConnectivityCheck(options)
}

export function getRecentCursorProbe(
  maxAgeMs: number = RECENT_PROBE_MAX_AGE_MS
): { ok: boolean; atMs: number; proxyNode?: string; latencyMs?: number } | null {
  if (!lastCursorProbe) {
    return null
  }
  if (Date.now() - lastCursorProbe.atMs > maxAgeMs) {
    return null
  }
  return lastCursorProbe
}

/** Defer failover only when a live api2 probe succeeds on the current node. */
export async function shouldDeferCursorFailover(currentProxy: string): Promise<boolean> {
  const transport = await resolveProbeTransportOptions()
  const probe = await runTransportProbePair(transport)
  lastRealProbeAtMs = Date.now()
  const proxyNode = await resolveCurrentProxyNode()
  lastCursorProbe = {
    ok: probe.api2Ok,
    atMs: lastRealProbeAtMs,
    proxyNode,
    latencyMs: probe.api2LatencyMs > 0 ? probe.api2LatencyMs : undefined
  }
  await appendLiveTransportProbeToLedger(probe, 'defer_check', {
    probeVia: transport.viaDirectTun ? 'tun' : 'mixed_port',
    errorDetail: 'defer_check: cursor_failover'
  })
  return shouldDeferDestructiveRecoveryAfterLiveProbe(probe.api2Ok, currentProxy, proxyNode)
}

export async function runCursorApiProbeCheck(): Promise<boolean> {
  return runCursorShortConnectivityCheck({ notify: false })
}

export async function recordProxySwitch(fromProxy: string, toProxy: string): Promise<void> {
  await appendEvent({
    ts: new Date().toISOString(),
    kind: 'proxy_switch',
    from_proxy: fromProxy,
    to_proxy: toProxy
  })
}

export async function startNetworkStabilityMonitor(): Promise<void> {
  if (isMonitoring) return
  isMonitoring = true
  shortProbeFailures = 0
  burstUntil = 0
  lastDeferProbeLogAt = 0
  wasOffline = false
  appendCount = 0
  resetNetworkAlertState()
  resetCursorTransportHealthState()
  seedTunLogWatchCursor()
  startCursorConnectionHygiene()
  startCursorTransportHealth()
  await ensureEventsDir()
  await pruneEventsFile()
  appendAppLog('[NetworkStabilityMonitor]: subsystems ON (probe cadence → api2ProbePlane)\n')
}

export function stopNetworkStabilityMonitor(): void {
  if (probeTimer) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
  clearTunLostDebounceTimer()
  tunLostSignalCount = 0
  stopCursorConnectionHygiene()
  stopCursorTransportHealth()
  isMonitoring = false
  isProbing = false
}
