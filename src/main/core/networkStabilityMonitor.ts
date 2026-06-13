import axios from 'axios'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { net } from 'electron'
import path from 'path'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mihomoGroups, mihomoProxyDelay } from './mihomoApi'
import { homeDir } from '../utils/dirs'

const PROBE_TARGET = 'https://api2.cursor.sh'
/** Agent SSE backend host (same family as Cursor Composer long streams). */
const LONG_PROBE_TARGET = 'https://agent.api5.cursor.sh'
const PROBE_INTERVAL_MS = 60_000
const LONG_PROBE_INTERVAL_MS = 5 * 60_000
const LONG_PROBE_HOLD_MS = 120_000
const BURST_PROBE_INTERVAL_MS = 15_000
const BURST_DURATION_MS = 5 * 60_000
const BURST_FAILURE_THRESHOLD = 2
const PROBE_TIMEOUT_MS = 15_000
const RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_FILE_BYTES = 5 * 1024 * 1024
const EVENTS_DIR = path.join(homeDir, '.sparkle')
const EVENTS_PATH = path.join(EVENTS_DIR, 'network-stability-events.jsonl')

type NetworkStabilityKind = 'probe' | 'long_probe' | 'proxy_switch' | 'offline' | 'online'

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
  probe_target_kind?: 'api2_short' | 'agent_long_hold'
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
let consecutiveFailures = 0
let burstUntil = 0
let appendCount = 0
let writeQueue: Promise<void> = Promise.resolve()
let wasOffline = false
let lastCursorProbe: { ok: boolean; atMs: number; proxyNode?: string } | null = null

const RECENT_PROBE_MAX_AGE_MS = 90_000

function getPrimaryProxyGroup(
  groups: ControllerMixedGroup[]
): ControllerMixedGroup | undefined {
  return (
    groups.find((group) => group.type === 'Selector' && group.name !== 'GLOBAL') ??
    groups.find((group) => group.name !== 'GLOBAL')
  )
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

async function resolveCurrentProxyNode(): Promise<string | undefined> {
  const groups = await mihomoGroups()
  if (!groups || groups.length === 0) return undefined
  const primaryGroup = getPrimaryProxyGroup(groups)
  return primaryGroup?.now
}

async function triggerCursorProxyFailover(trigger: string): Promise<void> {
  try {
    const { requestProxyFailover } = await import('./proxyHealthMonitor')
    await requestProxyFailover(trigger)
  } catch {
    // Failover is best-effort; probing must continue.
  }
}

async function probeCursorApiLongHold(
  proxyHost: string,
  proxyPort: number
): Promise<{
  ok: boolean
  status?: number
  latencyMs: number
  holdMs: number
  earlyClose: boolean
  errorCode?: string
  errorDetail?: string
}> {
  const startedAt = Date.now()
  try {
    const response = await axios.get(`${LONG_PROBE_TARGET}/`, {
      proxy: {
        host: proxyHost,
        port: proxyPort,
        protocol: 'http'
      },
      timeout: LONG_PROBE_HOLD_MS + 15_000,
      validateStatus: () => true,
      maxRedirects: 0,
      responseType: 'stream',
      headers: {
        Accept: 'text/event-stream, application/connect+proto, */*',
        'User-Agent': 'Sparkle-LongProbe/1.0'
      }
    })
    let earlyClose = false
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          response.data.destroy()
        } catch {
          // ignore stream teardown errors
        }
        resolve()
      }
      const timer = setTimeout(finish, LONG_PROBE_HOLD_MS)
      response.data.on('error', () => {
        earlyClose = true
        finish()
      })
      response.data.on('end', () => {
        earlyClose = true
        // Keep socket open for full hold window — mirrors Agent long SSE through proxy.
      })
      response.data.on('data', () => {
        /* drain */
      })
      response.data.resume()
    })
    const latencyMs = Date.now() - startedAt
    const transportOk = earlyClose
      ? latencyMs >= LONG_PROBE_HOLD_MS - 2_000
      : true
    return {
      ok:
        transportOk &&
        response.status > 0 &&
        response.status < 500,
      status: response.status,
      latencyMs,
      holdMs: latencyMs,
      earlyClose,
      errorCode: earlyClose && !transportOk ? 'LONG_PROBE_EARLY_CLOSE' : undefined,
      errorDetail:
        earlyClose && !transportOk
          ? `Stream closed after ${latencyMs}ms (hold target ${LONG_PROBE_HOLD_MS}ms)`
          : undefined
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      message?: string
      response?: { status?: number }
    }
    const latencyMs = Date.now() - startedAt
    return {
      ok: false,
      status: err.response?.status,
      latencyMs,
      holdMs: latencyMs,
      earlyClose: true,
      errorCode: err.code ?? 'LONG_PROBE_FAILED',
      errorDetail: err.message ?? String(error)
    }
  }
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
    const probeVia = `http://${host}:${port}`
    const proxyNode = await resolveCurrentProxyNode()
    const probeResult = await probeCursorApiLongHold(host, port)

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
      probe_target_kind: 'agent_long_hold',
      error_code: probeResult.errorCode,
      error_detail: probeResult.errorDetail
    })

    if (!probeResult.ok) {
      consecutiveFailures += 1
      if (consecutiveFailures >= BURST_FAILURE_THRESHOLD) {
        burstUntil = Date.now() + BURST_DURATION_MS
        void triggerCursorProxyFailover('agent-long-probe-failed')
      }
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
  proxyPort: number
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
      proxy: {
        host: proxyHost,
        port: proxyPort,
        protocol: 'http'
      },
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

  isProbing = true
  try {
    const ts = new Date().toISOString()
    const online = net.isOnline()

    if (!online) {
      if (!wasOffline) {
        await appendEvent({ ts, kind: 'offline' })
        wasOffline = true
      }
      consecutiveFailures += 1
      if (consecutiveFailures >= BURST_FAILURE_THRESHOLD) {
        burstUntil = Date.now() + BURST_DURATION_MS
      }
      scheduleNextProbe()
      return
    }

    if (wasOffline) {
      await appendEvent({ ts, kind: 'online' })
      wasOffline = false
    }

    const { host, port } = await getProxyEndpoint()
    const probeVia = `http://${host}:${port}`
    const proxyNode = await resolveCurrentProxyNode()

    let proxyDelayMs: number | undefined
    if (proxyNode) {
      try {
        const delayResult = await mihomoProxyDelay(proxyNode)
        proxyDelayMs = delayResult.delay ?? undefined
      } catch {
        proxyDelayMs = undefined
      }
    }

    const probeResult = await probeCursorApi(host, port)
    lastCursorProbe = {
      ok: probeResult.ok,
      atMs: Date.now(),
      proxyNode
    }
    await appendEvent({
      ts,
      kind: 'probe',
      proxy_node: proxyNode,
      proxy_delay_ms: proxyDelayMs,
      probe_target: PROBE_TARGET,
      probe_via: probeVia,
      probe_ok: probeResult.ok,
      probe_status: probeResult.status,
      probe_latency_ms: probeResult.latencyMs,
      probe_target_kind: 'api2_short',
      error_code: probeResult.errorCode,
      error_detail: probeResult.errorDetail
    })

    if (probeResult.ok) {
      consecutiveFailures = 0
      burstUntil = 0
    } else {
      consecutiveFailures += 1
      if (consecutiveFailures >= BURST_FAILURE_THRESHOLD) {
        burstUntil = Date.now() + BURST_DURATION_MS
        void triggerCursorProxyFailover('api2-probe-failed')
      }
    }
  } catch {
    consecutiveFailures += 1
    if (consecutiveFailures >= BURST_FAILURE_THRESHOLD) {
      burstUntil = Date.now() + BURST_DURATION_MS
    }
  } finally {
    isProbing = false
    scheduleNextProbe()
  }
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

export async function runCursorApiProbeCheck(): Promise<boolean> {
  const { host, port } = await getProxyEndpoint()
  const proxyNode = await resolveCurrentProxyNode()
  const probeResult = await probeCursorApi(host, port)
  lastCursorProbe = {
    ok: probeResult.ok,
    atMs: Date.now(),
    proxyNode
  }
  return probeResult.ok
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
  consecutiveFailures = 0
  burstUntil = 0
  wasOffline = false
  appendCount = 0
  await ensureEventsDir()
  await pruneEventsFile()
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
  isMonitoring = false
  isProbing = false
  isLongProbing = false
}
