import { execSync } from 'child_process'
import { getAppConfig, getControledMihomoConfig, patchAppConfig, patchControledMihomoConfig } from '../config'
export { CURSOR_PROCESS_NAMES, CURSOR_PROXY_DOMAINS, DEFAULT_CURSOR_PROXY_APP_PATH_PREFIXES, injectCursorDomainRules } from './cursorRuleInjection'
import { appendAppLog } from '../utils/log'
import { showNotification } from '../utils/notification'
import { triggerSysProxy } from '../sys/sysproxy'
import { defaultControledMihomoConfig } from '../utils/template'
import {
  buildControlledFakeIpFilter,
  TIER0_FAKE_IP_FILTER
} from './fakeIpRoutingIntegrity'
import {
  CURSOR_TUN_GSO_DARWIN,
  CURSOR_TUN_MTU_DARWIN,
  CURSOR_TUN_UDP_TIMEOUT_SEC,
} from './hysteria2QuicStability'

/** License Worker + Cloudflare Workers — fake-ip breaks TLS to *.workers.dev. */
export { TIER0_FAKE_IP_FILTER as CURSOR_FAKE_IP_FILTER } from './fakeIpRoutingIntegrity'

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

function mergeFakeIpFilter(existing: string[] | undefined): string[] {
  return buildControlledFakeIpFilter(
    existing?.length ? existing : [...(defaultControledMihomoConfig.dns?.['fake-ip-filter'] ?? [])]
  )
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
  const filterReady = TIER0_FAKE_IP_FILTER.every((entry) =>
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
    `[CursorNetworkOptimize]: keep-alive/quic-tun config patched (idle=${CURSOR_KEEP_ALIVE_IDLE_SEC}s gso=${CURSOR_TUN_GSO_DARWIN} mtu=${CURSOR_TUN_MTU_DARWIN} udp-timeout=${CURSOR_TUN_UDP_TIMEOUT_SEC}); applies on next core restart — no in-flight restartCore\n`
  )
  return true
}

/** Startup: TUN + fake-ip-filter + disable system HTTP proxy (fixes Cursor Chat/Agent diagnostic X). */
export async function bootstrapCursorNetworkDefaults(): Promise<void> {
  await applyCursorNetworkStack('startup-bootstrap', { notify: true })
}
