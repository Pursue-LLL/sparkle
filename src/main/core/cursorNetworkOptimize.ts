import { execSync } from 'child_process'
import { getAppConfig, getControledMihomoConfig, patchAppConfig, patchControledMihomoConfig } from '../config'
import { resolveCursorStableSelectorGroup } from './cursorProxyGroup'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { triggerSysProxy } from '../sys/sysproxy'
import { defaultControledMihomoConfig } from '../utils/template'
import {
  CURSOR_TUN_GSO_DARWIN,
  CURSOR_TUN_MTU_DARWIN,
  CURSOR_TUN_UDP_TIMEOUT_SEC,
} from './hysteria2QuicStability'

/** Cursor Agent / Chat API hosts (HTTP/2 bidi + SSE). */
const CURSOR_PROXY_DOMAINS = [
  'agent.api5.cursor.sh',
  'agentn.global.api5.cursor.sh',
  'agentn.global.api5lat.cursor.sh',
  'api2.cursor.sh',
  'api2geo.cursor.sh',
  'api2direct.cursor.sh',
  'api3.cursor.sh',
  'api5.cursor.sh',
  'prod.authentication.cursor.sh',
  'authenticator.cursor.sh',
  'repo42.cursor.sh',
  'downloads.cursor.com',
  'cursor-cdn.com',
  'metrics.cursor.sh',
  'cursorapi.com'
] as const

/** License Worker + Cloudflare Workers — fake-ip breaks TLS to *.workers.dev. */
const CURSOR_FAKE_IP_FILTER = [
  '+.cursor.sh',
  '+.cursor.com',
  '+.cursorapi.com',
  '+.cursor-cdn.com',
  '+.workers.dev',
  'cursor.sh',
] as const

/** Cursor domains resolve via stable DoH — avoids ENOTFOUND during TUN DNS jitter. */
const CURSOR_NAMESERVER_POLICY: Readonly<Record<string, readonly string[]>> = {
  '+.cursor.sh': ['https://dns.alidns.com/dns-query', 'tls://223.5.5.5'],
  '+.cursor.com': ['https://dns.alidns.com/dns-query', 'tls://223.5.5.5'],
  '+.cursorapi.com': ['https://dns.alidns.com/dns-query', 'tls://223.5.5.5'],
  '+.cursor-cdn.com': ['https://dns.alidns.com/dns-query']
}

/** Marathon Agent SSE: TCP keepalive must exceed typical proxy idle (15–30min). */
const CURSOR_KEEP_ALIVE_IDLE_SEC = 3600
const CURSOR_KEEP_ALIVE_INTERVAL_SEC = 60

export {
  CURSOR_LONG_PROBE_TARGET,
  CURSOR_LONG_STREAM_15M_CAP_MAX_MS,
  CURSOR_LONG_STREAM_15M_CAP_MIN_MS,
  CURSOR_MARATHON_PROBE_HOLD_MS,
  CURSOR_MARATHON_PROBE_INTERVAL_MS,
  CURSOR_STREAM_PROBE,
  isCursorLongStream15mCap,
  probeCursorApiLongHold,
  verifyCursorLongProbeTargetReachable,
  isCursorLongProbeMarathonApplicable
} from './cursorMarathonProbe'
import { CURSOR_STREAM_PROBE } from './cursorMarathonProbe'

const STREAM_BUFFER_MS = 2000

let cursorOptimizeApplied = false

function mergeFakeIpFilter(existing: string[] | undefined): string[] {
  const base = existing?.length ? [...existing] : [...(defaultControledMihomoConfig.dns?.['fake-ip-filter'] ?? [])]
  const set = new Set(base)
  for (const entry of CURSOR_FAKE_IP_FILTER) {
    set.add(entry)
  }
  return [...set]
}

function mergeNameserverPolicy(
  existing: Record<string, string[]> | undefined
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...(existing ?? {}) }
  for (const [domain, servers] of Object.entries(CURSOR_NAMESERVER_POLICY)) {
    merged[domain] = [...servers]
  }
  return merged
}

/** macOS default route interface (e.g. en0) — pins mihomo outbound when auto-detect fails. */
export function resolveDefaultNetworkInterface(): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined
  }
  try {
    const out = execSync('route -n get default', { encoding: 'utf8', timeout: 3000 })
    const match = out.match(/interface:\s*(\S+)/)
    return match?.[1]
  } catch {
    return undefined
  }
}

function isCursorDnsStackReady(controlled: Partial<MihomoConfig>): boolean {
  const filterReady = CURSOR_FAKE_IP_FILTER.every((entry) =>
    controlled.dns?.['fake-ip-filter']?.includes(entry)
  )
  const nsPolicy = controlled.dns?.['nameserver-policy'] as Record<string, string[]> | undefined
  const nsPolicyReady = Object.keys(CURSOR_NAMESERVER_POLICY).every(
    (domain) => nsPolicy?.[domain] !== undefined
  )
  const defaultIface = resolveDefaultNetworkInterface()
  const ifaceReady =
    defaultIface === undefined || controlled['interface-name'] === defaultIface
  return filterReady && nsPolicyReady && ifaceReady
}

function isCursorKeepAliveReady(controlled: Partial<MihomoConfig>): boolean {
  const idle = controlled['keep-alive-idle'] ?? 0
  return idle >= CURSOR_KEEP_ALIVE_IDLE_SEC && controlled['disable-keep-alive'] !== true
}

function isCursorTunQuicReady(controlled: Partial<MihomoConfig>): boolean {
  if (process.platform !== 'darwin') return true
  const tun = controlled.tun
  if (!tun?.enable) return false
  const udpTimeout = tun['udp-timeout'] ?? 0
  const mtu = tun.mtu ?? 1500
  return tun.gso === CURSOR_TUN_GSO_DARWIN && mtu <= CURSOR_TUN_MTU_DARWIN && udpTimeout >= CURSOR_TUN_UDP_TIMEOUT_SEC
}

/** Prepend Cursor domain rules so Agent/Chat traffic uses a fixed Selector (never UrlTest). */
export function injectCursorDomainRules(profile: MihomoConfig): void {
  const groups = profile['proxy-groups'] as ControllerMixedGroup[] | undefined
  const mainGroup = resolveCursorStableSelectorGroup(groups ?? [])?.name
  if (!mainGroup) return

  const rules = (profile.rules as string[] | undefined) ?? []
  const existing = new Set(rules.map((rule) => rule.trim()))
  const prefix: string[] = []

  for (const domain of CURSOR_PROXY_DOMAINS) {
    const rule = `DOMAIN,${domain},${mainGroup}`
    if (!existing.has(rule)) {
      prefix.push(rule)
    }
  }
  const suffixRule = `DOMAIN-SUFFIX,cursor.sh,${mainGroup}`
  if (!existing.has(suffixRule)) {
    prefix.push(suffixRule)
  }
  const comSuffixRule = `DOMAIN-SUFFIX,cursor.com,${mainGroup}`
  if (!existing.has(comSuffixRule)) {
    prefix.push(comSuffixRule)
  }

  if (prefix.length > 0) {
    profile.rules = [...prefix, ...rules] as MihomoConfig['rules']
  }
}

function buildCursorTunPatch(controlled: Partial<MihomoConfig>): Partial<MihomoConfig> {
  const tunDefaults = defaultControledMihomoConfig.tun ?? {}
  const defaultIface = resolveDefaultNetworkInterface()
  const tun: MihomoTunConfig = {
    ...tunDefaults,
    ...controlled.tun,
    enable: true,
    stack: process.platform === 'darwin' ? 'system' : (controlled.tun?.stack ?? tunDefaults.stack ?? 'mixed'),
    'auto-route': true,
    'auto-detect-interface': true
  }
  if (process.platform === 'darwin') {
    tun.gso = CURSOR_TUN_GSO_DARWIN
    tun.mtu = CURSOR_TUN_MTU_DARWIN
    tun['udp-timeout'] = CURSOR_TUN_UDP_TIMEOUT_SEC
  }
  return {
    ...(defaultIface ? { 'interface-name': defaultIface } : {}),
    'keep-alive-idle': CURSOR_KEEP_ALIVE_IDLE_SEC,
    'keep-alive-interval': CURSOR_KEEP_ALIVE_INTERVAL_SEC,
    'disable-keep-alive': false,
    tun,
    'tcp-concurrent': true,
    dns: {
      ...controlled.dns,
      'fake-ip-filter': mergeFakeIpFilter(controlled.dns?.['fake-ip-filter']),
      'nameserver-policy': mergeNameserverPolicy(
        controlled.dns?.['nameserver-policy'] as Record<string, string[]> | undefined
      )
    }
  }
}

async function applyCursorNetworkStack(
  reason: string,
  options: { notify?: boolean } = {}
): Promise<boolean> {
  const appConfig = await getAppConfig()
  if (appConfig.cursorBidiOptimize === false) {
    return false
  }

  const controlled = await getControledMihomoConfig()
  const tunEnabled = controlled.tun?.enable === true
  const dnsStackReady = isCursorDnsStackReady(controlled)
  const keepAliveReady = isCursorKeepAliveReady(controlled)
  const tunQuicReady = isCursorTunQuicReady(controlled)
  const sysProxyOn = appConfig.sysProxy?.enable === true

  let changed = false

  if (!tunEnabled || !dnsStackReady || !keepAliveReady || !tunQuicReady) {
    await patchControledMihomoConfig(buildCursorTunPatch(controlled))
    changed = true
  }

  if (sysProxyOn) {
    await patchAppConfig({
      sysProxy: {
        ...appConfig.sysProxy,
        enable: false
      },
      cursorSysProxyLock: true
    })
    await triggerSysProxy(false, appConfig.onlyActiveDevice ?? false)
    changed = true
  } else if (appConfig.cursorSysProxyLock !== true) {
    await patchAppConfig({ cursorSysProxyLock: true })
  }

  if (!changed) {
    return false
  }

  const detail = `Cursor network optimize (${reason}): TUN on, keep-alive ${CURSOR_KEEP_ALIVE_IDLE_SEC}s, system HTTP proxy off, cursor.sh rules on next core start. Re-run Cursor Network Diagnostics.`
  await appendAppLog(`[CursorNetworkOptimize]: ${detail}\n`)
  if (options.notify !== false) {
    showNotification({
      title: 'Sparkle: Cursor stream/bidi optimize',
      body: detail,
      variant: 'warning'
    })
  }

  return true
}

/** Re-apply marathon keep-alive if user/profile reset mihomo defaults (600s idle). */
export async function ensureCursorMarathonKeepAlive(): Promise<boolean> {
  const appConfig = await getAppConfig()
  if (appConfig.cursorBidiOptimize === false) {
    return false
  }
  const controlled = await getControledMihomoConfig()
  if (isCursorKeepAliveReady(controlled) && isCursorTunQuicReady(controlled)) {
    return false
  }
  await patchControledMihomoConfig(buildCursorTunPatch(controlled))
  await appendAppLog(
    `[CursorNetworkOptimize]: keep-alive/quic-tun restored (idle=${CURSOR_KEEP_ALIVE_IDLE_SEC}s gso=${CURSOR_TUN_GSO_DARWIN} mtu=${CURSOR_TUN_MTU_DARWIN} udp-timeout=${CURSOR_TUN_UDP_TIMEOUT_SEC})\n`
  )
  const { restartCore } = await import('./manager')
  await restartCore()
  return true
}

/** Startup: TUN + fake-ip-filter + disable system HTTP proxy (fixes Cursor Chat/Agent diagnostic X). */
export async function bootstrapCursorNetworkDefaults(): Promise<void> {
  await applyCursorNetworkStack('startup-bootstrap', { notify: true })
}

/** One-shot recovery when probes still detect buffering after startup. */
export async function applyCursorBidiOptimize(reason: string): Promise<boolean> {
  if (cursorOptimizeApplied) {
    return false
  }

  const changed = await applyCursorNetworkStack(reason, { notify: true })
  if (!changed) {
    return false
  }

  cursorOptimizeApplied = true

  const { restartCore } = await import('./manager')
  await restartCore()

  return true
}

/** Mirror Cursor stream diagnostic: first chunk >2s ⇒ proxy buffering. */
export async function probeCursorStreamBuffering(
  proxyHost: string,
  proxyPort: number,
  viaDirectTun = false
): Promise<{ buffered: boolean; firstByteMs: number; status?: number; errorDetail?: string }> {
  const startedAt = Date.now()
  try {
    const axios = (await import('axios')).default
    const response = await axios.get(CURSOR_STREAM_PROBE, {
      ...(viaDirectTun
        ? {}
        : { proxy: { host: proxyHost, port: proxyPort, protocol: 'http' } }),
      timeout: 15_000,
      validateStatus: () => true,
      maxRedirects: 0,
      responseType: 'stream',
      headers: {
        Accept: 'text/event-stream, application/connect+proto, */*',
        'User-Agent': 'Sparkle-StreamProbe/1.0'
      }
    })

    const firstByteMs = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('stream probe timeout'))
      }, 12_000)
      response.data.once('data', () => {
        clearTimeout(timer)
        resolve(Date.now() - startedAt)
      })
      response.data.once('error', (err: Error) => {
        clearTimeout(timer)
        reject(err)
      })
      response.data.resume()
    })

    try {
      response.data.destroy()
    } catch {
      /* ignore */
    }

    return {
      buffered: firstByteMs > STREAM_BUFFER_MS,
      firstByteMs,
      status: response.status
    }
  } catch (error) {
    const err = error as Error
    return {
      buffered: true,
      firstByteMs: Date.now() - startedAt,
      errorDetail: err.message ?? String(error)
    }
  }
}

export function resetCursorOptimizeAppliedForTests(): void {
  cursorOptimizeApplied = false
}

/** Mixed-port 502 + early_close indicates proxy stack issue, not a bad node. */
export function isCursorBidiSystemicFailure(probe: {
  status?: number
  earlyClose?: boolean
  errorCode?: string
  welcomeOnly?: boolean
  marathonApplicable?: boolean
}): boolean {
  if (!isCursorLongProbeMarathonApplicable(probe)) {
    return false
  }
  return (
    probe.status === 502 ||
    probe.errorCode === 'LONG_PROBE_EARLY_CLOSE' ||
    probe.errorCode === 'LONG_PROBE_FAILED'
  )
}
