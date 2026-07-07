import axios from 'axios'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { net } from 'electron'
import path from 'path'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mihomoGroups, mihomoProxyDelay } from './mihomoApi'
import { homeDir } from '../utils/dirs'
import {
  applyCursorBidiOptimize,
  CURSOR_LONG_PROBE_TARGET,
  CURSOR_MARATHON_PROBE_INTERVAL_MS,
  ensureCursorMarathonKeepAlive,
  isCursorBidiSystemicFailure,
  isCursorLongStream15mCap,
  probeCursorApiLongHold,
  probeCursorStreamBuffering,
  verifyCursorLongProbeTargetReachable
} from './cursorNetworkOptimize'
import { resolveCursorStableSelectorGroup } from './cursorProxyGroup'
import {
  evaluateLongStreamAlert,
  evaluateNetworkProbeAlert,
  handleNetworkOfflineAlert,
  resetNetworkAlertState
} from './networkAlertNotifier'
import { shouldSkipCommercialBenchmarkDuringBurst } from './networkBurstGateCore'
import { shouldDeferShortProbeDuringLongHold } from './networkStabilityProbeGateCore'
import { appendAppLog, getCachedMihomoLogs } from '../utils/log'
import { showNotification } from '../utils/notification'

const PROBE_TARGET = 'https://api2.cursor.sh'
/** Agent SSE backend — long hold uses api2 (agent.api5 is Connect/binary, not plain HTTP). */
const LONG_PROBE_TARGET = CURSOR_LONG_PROBE_TARGET
const PROBE_INTERVAL_MS = 60_000
/** Keep in sync with cursorNetworkOptimize marathon probe timing. */
const LONG_PROBE_INTERVAL_MS = CURSOR_MARATHON_PROBE_INTERVAL_MS
const BURST_PROBE_INTERVAL_MS = 15_000
const BURST_DURATION_MS = 5 * 60_000
const BURST_FAILURE_THRESHOLD = 2
const PROBE_TIMEOUT_MS = 15_000
const LONG_PROBE_PROXY_SMOKE_DELAY_MS = 25_000
const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_FILE_BYTES = 5 * 1024 * 1024
const TUN_RESTART_COOLDOWN_MS = 5 * 60_000
/** Wait before restart — filters transient TUN monitor glitches (~sub-second). */
const TUN_LOST_DEBOUNCE_MS = 3_000
const TUN_INTERFACE_LOST_RE = /\[TUN\] default interface lost by monitor/
const EVENTS_DIR = path.join(homeDir, '.sparkle')
const EVENTS_PATH = path.join(EVENTS_DIR, 'network-stability-events.jsonl')

type NetworkStabilityKind =
  | 'probe'
  | 'long_probe'
  | 'stream_buffer_probe'
  | 'proxy_switch'
  | 'offline'
  | 'online'
  | 'tun_interface_lost'
  | 'tun_interface_recovered'

interface NetworkStabilityEvent {
  ts: string
  kind: NetworkStabilityKind
  proxy_node?: string
  proxy_delay_ms?: number
  probe_target?: string
  probe_via?: string
  probe_ok?: boolean
  probe_status?: number
  probe_latency_ms?: number
  probe_hold_ms?: number
  probe_early_close?: boolean
  probe_target_kind?: 'api2_short' | 'api2_long_hold' | 'api2_stream_buffer'
  stream_first_byte_ms?: number
  stream_buffered?: boolean
  error_code?: string
  error_detail?: string
  from_proxy?: string
  to_proxy?: string
}

let probeTimer: NodeJS.Timeout | null = null
let longProbeTimer: NodeJS.Timeout | null = null
let isMonitoring = false
let isProbing = false
let isLongProbing = false
let shortProbeFailures = 0
let longProbeFailures = 0
let bidiOptimizeTriggered = false
let burstUntil = 0
let appendCount = 0
let writeQueue: Promise<void> = Promise.resolve()
let wasOffline = false
let lastCursorProbe: { ok: boolean; atMs: number; proxyNode?: string } | null = null
let lastLongProbe: {
  ok: boolean
  atMs: number
  status?: number
  earlyClose?: boolean
  proxyNode?: string
} | null = null
let lastTunWatchSeq = 0
let lastTunRestartAt = 0
let tunInterfaceLostLatched = false
let tunRecoverInFlight = false
let tunLostDebounceTimer: NodeJS.Timeout | null = null
let tunLostSignalCount = 0

const RECENT_PROBE_MAX_AGE_MS = 90_000
const RECENT_LONG_PROBE_MAX_AGE_MS = 10 * 60_000

async function tryApplyCursorBidiOptimize(reason: string): Promise<boolean> {
  const proxyNode = await resolveCurrentProxyNode()
  if (proxyNode && (await shouldDeferCursorFailover(proxyNode))) {
    await appendAppLog(
      `[NetworkStabilityMonitor]: defer bidi optimize (${reason}) — api2 reachable on "${proxyNode}"\n`
    )
    return false
  }
  return applyCursorBidiOptimize(reason)
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

function scheduleNextProbe(delayMs: number = getNextProbeDelayMs()): void {
  if (!isMonitoring) return
  if (probeTimer) {
    clearTimeout(probeTimer)
  }
  probeTimer = setTimeout(() => {
    void runProbeCycle()
  }, delayMs)
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
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      // Non-fatal: probing must continue even if rotation fails.
    }
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
  const groups = await mihomoGroups()
  if (!groups || groups.length === 0) return undefined
  const primaryGroup = getPrimaryProxyGroup(groups)
  return primaryGroup?.now
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
  return shouldDeferCursorFailover(proxyNode)
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
  if (api2Ok) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: TUN lost debounced — api2 still reachable after grace window, skip restart\n'
    )
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: 'debounced tun lost — api2 reachable, no restartCore'
    })
    tunInterfaceLostLatched = false
    return
  }

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

  if (await shouldDeferTunCoreRestart()) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: defer TUN restart at handle — Cursor api2 reachable on current node\n'
    )
    tunInterfaceLostLatched = false
    return
  }

  if (now - lastTunRestartAt < TUN_RESTART_COOLDOWN_MS) {
    await appendAppLog(
      '[NetworkStabilityMonitor]: TUN interface lost — restart skipped (cooldown active)\n'
    )
    tunInterfaceLostLatched = false
    return
  }

  await appendEvent({
    ts: new Date().toISOString(),
    kind: 'tun_interface_lost',
    error_code: 'TUN_INTERFACE_LOST_CONFIRMED',
    error_detail: 'mihomo TUN default interface lost — confirmed, restarting core'
  })

  tunRecoverInFlight = true
  try {
    await appendAppLog('[NetworkStabilityMonitor]: TUN interface lost — restarting mihomo core\n')
    await showNotification({
      id: 'sparkle-tun-interface-lost',
      title: 'Sparkle: TUN 网卡丢失',
      body: '检测到 mihomo TUN default interface lost，正在自动重启 core 恢复 DNS…',
      variant: 'warning'
    })
    lastTunRestartAt = now
    burstUntil = Date.now() + BURST_DURATION_MS
    const { restartCore } = await import('./manager')
    await restartCore()
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'tun_interface_recovered',
      error_detail: 'auto restartCore after tun interface lost'
    })
    tunInterfaceLostLatched = false
  } catch (error) {
    await appendAppLog(
      `[NetworkStabilityMonitor]: TUN recovery restart failed: ${error instanceof Error ? error.message : String(error)}\n`
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

async function runLongProbeCycle(): Promise<void> {
  if (!isMonitoring || isLongProbing) {
    scheduleNextLongProbe()
    return
  }

  isLongProbing = true
  try {
    if (!net.isOnline()) {
      scheduleNextLongProbe()
      return
    }

    const ts = new Date().toISOString()
    const { host, port } = await getProxyEndpoint()
    const viaDirectTun = await shouldProbeViaDirectTun()
    const probeVia = viaDirectTun ? 'direct/tun' : `http://${host}:${port}`
    const proxyNode = await resolveCurrentProxyNode()
    const probeResult = await probeCursorApiLongHold(host, port, viaDirectTun)
    lastLongProbe = {
      ok: probeResult.ok,
      atMs: Date.now(),
      status: probeResult.status,
      earlyClose: probeResult.earlyClose,
      proxyNode
    }

    await appendEvent({
      ts,
      kind: 'long_probe',
      proxy_node: proxyNode,
      probe_target: LONG_PROBE_TARGET,
      probe_via: probeVia,
      probe_ok: probeResult.ok,
      probe_status: probeResult.status,
      probe_latency_ms: probeResult.latencyMs,
      probe_hold_ms: probeResult.holdMs,
      probe_early_close: probeResult.earlyClose,
      probe_target_kind: 'api2_long_hold',
      error_code: probeResult.errorCode,
      error_detail: probeResult.errorDetail
    })

    void evaluateLongStreamAlert({
      proxyNode,
      probeOk: probeResult.ok,
      systemicFailure:
        isCursorLongStream15mCap(probeResult) ||
        isCursorBidiSystemicFailure({
          status: probeResult.status,
          earlyClose: probeResult.earlyClose,
          errorCode: probeResult.errorCode
        }),
      errorDetail: probeResult.errorDetail
    })

    if (isCursorLongStream15mCap(probeResult)) {
      void showNotification({
        title: 'Sparkle: 15min 长流上限',
        body: `节点 ${proxyNode ?? 'unknown'} 在 ~${Math.round(probeResult.holdMs / 60_000)}min 切断 SSE。建议切到 24h 推荐节点 / 自建 VPS。`,
        variant: 'warning'
      })
    }

    const streamProbe = await probeCursorStreamBuffering(host, port, viaDirectTun)
    await appendEvent({
      ts: new Date().toISOString(),
      kind: 'stream_buffer_probe',
      proxy_node: proxyNode,
      probe_target: PROBE_TARGET,
      probe_via: probeVia,
      probe_ok: !streamProbe.buffered,
      probe_status: streamProbe.status,
      probe_latency_ms: streamProbe.firstByteMs,
      probe_target_kind: 'api2_stream_buffer',
      stream_first_byte_ms: streamProbe.firstByteMs,
      stream_buffered: streamProbe.buffered,
      error_detail: streamProbe.errorDetail
    })

    if (!probeResult.ok) {
      longProbeFailures += 1

      const bidiLikelyBroken =
        streamProbe.buffered ||
        isCursorBidiSystemicFailure({
          status: probeResult.status,
          earlyClose: probeResult.earlyClose,
          errorCode: probeResult.errorCode
        })

      const { autoProxySwitch = true } = await getAppConfig()
      if (
        autoProxySwitch &&
        !bidiOptimizeTriggered &&
        bidiLikelyBroken &&
        longProbeFailures >= BURST_FAILURE_THRESHOLD
      ) {
        bidiOptimizeTriggered = await tryApplyCursorBidiOptimize('agent-long-probe-failed')
      }

      if (longProbeFailures >= BURST_FAILURE_THRESHOLD) {
        longProbeFailures = 0
      }
    } else {
      longProbeFailures = 0
    }
  } catch {
    // Long probe is diagnostic-only; failures must not interrupt short probes.
  } finally {
    isLongProbing = false
    scheduleNextLongProbe()
  }
}

function scheduleNextLongProbe(delayMs: number = LONG_PROBE_INTERVAL_MS): void {
  if (!isMonitoring) return
  if (longProbeTimer) {
    clearTimeout(longProbeTimer)
  }
  longProbeTimer = setTimeout(() => {
    void runLongProbeCycle()
  }, delayMs)
}

async function probeCursorApi(
  proxyHost: string,
  proxyPort: number,
  viaDirectTun = false
): Promise<{
  ok: boolean
  status?: number
  latencyMs: number
  errorCode?: string
  errorDetail?: string
}> {
  const startedAt = Date.now()
  try {
    const response = await axios.head(PROBE_TARGET, {
      ...(viaDirectTun
        ? {}
        : {
            proxy: {
              host: proxyHost,
              port: proxyPort,
              protocol: 'http'
            }
          }),
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      maxRedirects: 0
    })
    const latencyMs = Date.now() - startedAt
    return {
      ok: response.status > 0 && response.status < 500,
      status: response.status,
      latencyMs
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      message?: string
      response?: { status?: number }
    }
    return {
      ok: false,
      status: err.response?.status,
      latencyMs: Date.now() - startedAt,
      errorCode: err.code ?? 'PROBE_FAILED',
      errorDetail: err.message ?? String(error)
    }
  }
}

async function runProbeCycle(): Promise<void> {
  if (!isMonitoring || isProbing) {
    scheduleNextProbe()
    return
  }
  if (shouldDeferShortProbeDuringLongHold(isLongProbing)) {
    scheduleNextProbe()
    return
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
        burstUntil = Date.now() + BURST_DURATION_MS
      }
      scheduleNextProbe()
      return
    }

    if (wasOffline) {
      await appendEvent({ ts, kind: 'online' })
      wasOffline = false
      burstUntil = 0
      shortProbeFailures = 0
    }

    await scanTunLogEvents()

    void ensureCursorMarathonKeepAlive()

    const connectivityOk = await runCursorShortConnectivityCheck({ notify: true })
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
        burstUntil = Date.now() + BURST_DURATION_MS
      }
    }
  } catch {
    shortProbeFailures += 1
    if (shortProbeFailures >= BURST_FAILURE_THRESHOLD) {
      burstUntil = Date.now() + BURST_DURATION_MS
    }
  } finally {
    isProbing = false
    scheduleNextProbe()
  }
}

export function getNetworkBurstUntilMs(): number {
  return burstUntil
}

/** True while the 60s short connectivity cycle (axios HEAD) is in flight. */
export function isNetworkStabilityShortProbeActive(): boolean {
  return isProbing
}

export function isNetworkStabilityLongProbeActive(): boolean {
  return isLongProbing
}

export { shouldDeferShortProbeDuringLongHold } from './networkStabilityProbeGateCore'

export function isNetworkStabilityBurstActive(nowMs: number = Date.now()): boolean {
  return shouldSkipCommercialBenchmarkDuringBurst(burstUntil, nowMs)
}

export function getRecentLongProbeFailure(
  maxAgeMs: number = RECENT_LONG_PROBE_MAX_AGE_MS
): {
  ok: boolean
  atMs: number
  status?: number
  earlyClose?: boolean
  proxyNode?: string
} | null {
  if (!lastLongProbe) {
    return null
  }
  if (Date.now() - lastLongProbe.atMs > maxAgeMs) {
    return null
  }
  if (lastLongProbe.ok) {
    return null
  }
  return lastLongProbe
}

interface CursorShortConnectivityOptions {
  /** When true, drive networkAlertEnabled notifications (60s monitor). */
  notify?: boolean
}

/** HTTP api2 check via current proxy — does not write mihomo proxy.history or events jsonl. */
async function runCursorShortConnectivityCheck(
  options: CursorShortConnectivityOptions = {}
): Promise<boolean> {
  const { host, port } = await getProxyEndpoint()
  const viaDirectTun = await shouldProbeViaDirectTun()
  const proxyNode = await resolveCurrentProxyNode()
  const probeResult = await probeCursorApi(host, port, viaDirectTun)
  const proxyDelayMs =
    probeResult.latencyMs > 0 ? probeResult.latencyMs : undefined
  lastCursorProbe = {
    ok: probeResult.ok,
    atMs: Date.now(),
    proxyNode
  }
  if (options.notify) {
    void evaluateNetworkProbeAlert({
      proxyNode,
      proxyDelayMs,
      probeOk: probeResult.ok,
      probeLatencyMs: probeResult.latencyMs,
      errorDetail: probeResult.errorDetail
    })
  }
  return probeResult.ok
}

async function verifyCursorLongProbeViaCurrentProxy(): Promise<{
  ok: boolean
  proxyNode?: string
  delayMs?: number
  errorDetail?: string
}> {
  try {
    const proxyNode = await resolveCurrentProxyNode()
    if (!proxyNode) {
      return { ok: false, errorDetail: 'no current Cursor proxy node' }
    }
    const result = await mihomoProxyDelay(proxyNode, LONG_PROBE_TARGET)
    const delayMs = result.delay ?? 0
    if (delayMs <= 0) {
      return {
        ok: false,
        proxyNode,
        errorDetail: `mihomo delay to ${LONG_PROBE_TARGET} timed out`
      }
    }
    return { ok: true, proxyNode, delayMs }
  } catch (error) {
    const err = error as Error
    return { ok: false, errorDetail: err.message ?? String(error) }
  }
}

function scheduleLongProbeProxySmoke(): void {
  setTimeout(() => {
    void (async () => {
      if (!isMonitoring) return
      const proxySmoke = await verifyCursorLongProbeViaCurrentProxy()
      if (!proxySmoke.ok) {
        appendAppLog(
          `[NetworkStability]: long_probe proxy smoke FAILED (${proxySmoke.proxyNode ?? 'unknown'}): ${proxySmoke.errorDetail ?? 'unknown'}\n`
        )
        return
      }
      appendAppLog(
        `[NetworkStability]: long_probe proxy smoke OK (${proxySmoke.proxyNode}, ${proxySmoke.delayMs}ms → ${LONG_PROBE_TARGET})\n`
      )
    })()
  }, LONG_PROBE_PROXY_SMOKE_DELAY_MS)
}

export function getRecentCursorProbe(
  maxAgeMs: number = RECENT_PROBE_MAX_AGE_MS
): { ok: boolean; atMs: number; proxyNode?: string } | null {
  if (!lastCursorProbe) {
    return null
  }
  if (Date.now() - lastCursorProbe.atMs > maxAgeMs) {
    return null
  }
  return lastCursorProbe
}

export function getRecentHealthyCursorProbe(
  maxAgeMs: number = RECENT_PROBE_MAX_AGE_MS
): { ok: true; atMs: number; proxyNode?: string } | null {
  const recent = getRecentCursorProbe(maxAgeMs)
  if (!recent?.ok) {
    return null
  }
  return { ok: true, atMs: recent.atMs, proxyNode: recent.proxyNode }
}

/** Defer failover while Cursor API is reachable — avoids killing in-flight Agent streams. */
export async function shouldDeferCursorFailover(currentProxy: string): Promise<boolean> {
  const healthy = getRecentHealthyCursorProbe()
  if (healthy?.proxyNode === currentProxy) {
    return true
  }
  return runCursorApiProbeCheck()
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
  longProbeFailures = 0
  burstUntil = 0
  wasOffline = false
  appendCount = 0
  lastTunRestartAt = 0
  resetNetworkAlertState()
  seedTunLogWatchCursor()
  await ensureEventsDir()
  await pruneEventsFile()
  const longProbeSmoke = await verifyCursorLongProbeTargetReachable()
  if (!longProbeSmoke.ok) {
    appendAppLog(
      `[NetworkStability]: long_probe target smoke FAILED (${LONG_PROBE_TARGET}): ${longProbeSmoke.errorDetail ?? 'unknown'}\n`
    )
  } else {
    appendAppLog(
      `[NetworkStability]: long_probe target smoke OK (${LONG_PROBE_TARGET}, HTTP ${longProbeSmoke.status ?? '?'})\n`
    )
  }
  scheduleLongProbeProxySmoke()
  scheduleNextProbe(5_000)
  scheduleNextLongProbe(30_000)
}

export function stopNetworkStabilityMonitor(): void {
  if (probeTimer) {
    clearTimeout(probeTimer)
    probeTimer = null
  }
  if (longProbeTimer) {
    clearTimeout(longProbeTimer)
    longProbeTimer = null
  }
  clearTunLostDebounceTimer()
  tunLostSignalCount = 0
  isMonitoring = false
  isProbing = false
  isLongProbing = false
}
