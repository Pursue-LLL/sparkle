import { execFile } from 'child_process'
import { promisify } from 'util'
import { isPublicIpv4 } from './vpsDirectBypass'

const execFileAsync = promisify(execFile)

export const VPS_L4_PROBE_INTERVAL_MS = 300_000
export const VPS_SSH_CONNECT_TIMEOUT_SEC = 10
export const VPS_L4_CURL_TIMEOUT_SEC = 10

export const VPS_SSH_HOSTS = [
  { sshHost: 'kr-vps', region: 'KR-VPS' as const },
  { sshHost: 'jp-vps', region: 'JP-VPS' as const }
]

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/

export type VpsProbeAttribution = 'healthy' | 'ssh_target_unresolved' | 'fake_ip_misroute'

export type VpsSshResolvedVia = 'ssh_g' | 'leaf_proxy_fallback'

export interface VpsSshResolvedTarget {
  sshHost: string
  hostName: string
  port: number
  user?: string
  identityFiles: string[]
  resolvedVia: VpsSshResolvedVia
}

export interface VpsL4CurlLine {
  label: string
  timeTotalSec: number
  httpCode: number
}

export interface VpsL4ProbeResult {
  region: 'KR-VPS' | 'JP-VPS'
  sshHost: string
  api2Ok: boolean
  api2LatencyMs: number
  marketplaceOk: boolean
  marketplaceLatencyMs: number
  authoritative: boolean
  probeAttribution?: VpsProbeAttribution
  sshConnectHost?: string
  resolvedVia?: VpsSshResolvedVia
  errorDetail?: string
}

const VPS_REMOTE_CURL =
  "curl -o /dev/null -s -w 'api2 %{time_total} %{http_code}\\n' " +
  `--connect-timeout ${VPS_L4_CURL_TIMEOUT_SEC} https://api2.cursor.sh && ` +
  "curl -o /dev/null -s -w 'marketplace %{time_total} %{http_code}\\n' " +
  `--connect-timeout ${VPS_L4_CURL_TIMEOUT_SEC} https://marketplace.cursorapi.com`

export function parseSshGOutput(stdout: string): {
  hostName: string
  port: number
  user?: string
  identityFiles: string[]
} {
  const fields = new Map<string, string[]>()
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const space = line.indexOf(' ')
    if (space <= 0) continue
    const key = line.slice(0, space)
    const value = line.slice(space + 1)
    const bucket = fields.get(key) ?? []
    bucket.push(value)
    fields.set(key, bucket)
  }

  const hostName = fields.get('hostname')?.[0] ?? ''
  const portRaw = fields.get('port')?.[0]
  const parsedPort = portRaw ? Number.parseInt(portRaw, 10) : 22
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 22
  const user = fields.get('user')?.[0]
  const identityFiles = fields.get('identityfile') ?? []
  return { hostName, port, user, identityFiles }
}

export function isFakeIpHost(hostName: string): boolean {
  if (!IPV4_PATTERN.test(hostName)) {
    return false
  }
  return !isPublicIpv4(hostName)
}

export function isUnresolvedSshHostName(hostName: string, sshHost: string): boolean {
  if (!hostName) {
    return true
  }
  if (hostName === sshHost) {
    return true
  }
  if (!IPV4_PATTERN.test(hostName)) {
    return true
  }
  return !isPublicIpv4(hostName)
}

function isVpsLeafProxyForRegion(name: string, region: 'KR-VPS' | 'JP-VPS'): boolean {
  const normalized = name.toUpperCase()
  const regionToken = region.replace('-VPS', '')
  return /VPS/.test(normalized) && normalized.includes(regionToken)
}

export function resolveVpsServerIpByRegion(
  region: 'KR-VPS' | 'JP-VPS',
  leafProxies: unknown[]
): string | undefined {
  for (const raw of leafProxies) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const proxy = raw as Record<string, unknown>
    const name = typeof proxy.name === 'string' ? proxy.name : ''
    if (!isVpsLeafProxyForRegion(name, region)) {
      continue
    }
    const server = proxy.server
    if (typeof server === 'string' && IPV4_PATTERN.test(server) && isPublicIpv4(server)) {
      return server
    }
  }
  return undefined
}

export function resolveVpsSshTarget(
  sshHost: string,
  region: 'KR-VPS' | 'JP-VPS',
  sshG: { hostName: string; port: number; user?: string; identityFiles: string[] },
  leafProxies: unknown[]
): VpsSshResolvedTarget | null {
  const fromSshG: VpsSshResolvedTarget = {
    sshHost,
    hostName: sshG.hostName,
    port: sshG.port,
    user: sshG.user,
    identityFiles: sshG.identityFiles,
    resolvedVia: 'ssh_g'
  }

  if (!isUnresolvedSshHostName(sshG.hostName, sshHost) && !isFakeIpHost(sshG.hostName)) {
    return fromSshG
  }

  const fallbackIp = resolveVpsServerIpByRegion(region, leafProxies)
  if (!fallbackIp) {
    return null
  }

  return {
    sshHost,
    hostName: fallbackIp,
    port: sshG.port,
    user: sshG.user,
    identityFiles: sshG.identityFiles,
    resolvedVia: 'leaf_proxy_fallback'
  }
}

export function buildVpsSshArgs(target: VpsSshResolvedTarget, remoteCommand: string): string[] {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${VPS_SSH_CONNECT_TIMEOUT_SEC}`,
    '-o',
    'ProxyCommand=none',
    '-o',
    `HostName=${target.hostName}`,
    '-p',
    String(target.port)
  ]
  if (target.user) {
    args.push('-l', target.user)
  }
  for (const identityFile of target.identityFiles) {
    args.push('-i', identityFile)
  }
  args.push(target.sshHost, remoteCommand)
  return args
}

export function detectFakeIpMisroute(errorMessage: string): boolean {
  return /198\.18\.|198\.19\./.test(errorMessage)
}

export function parseVpsL4CurlOutput(stdout: string): {
  api2?: VpsL4CurlLine
  marketplace?: VpsL4CurlLine
} {
  const result: { api2?: VpsL4CurlLine; marketplace?: VpsL4CurlLine } = {}
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^(api2|marketplace)\s+([\d.]+)\s+(\d{3})$/)
    if (!match) continue
    const parsed: VpsL4CurlLine = {
      label: match[1],
      timeTotalSec: Number.parseFloat(match[2]),
      httpCode: Number.parseInt(match[3], 10)
    }
    if (parsed.label === 'api2') {
      result.api2 = parsed
    } else {
      result.marketplace = parsed
    }
  }
  return result
}

export function buildVpsL4ProbeResult(
  sshHost: string,
  region: 'KR-VPS' | 'JP-VPS',
  stdout: string,
  stderr: string,
  target?: VpsSshResolvedTarget
): VpsL4ProbeResult {
  const parsed = parseVpsL4CurlOutput(stdout)
  const api2 = parsed.api2
  const marketplace = parsed.marketplace
  const api2Ok = api2 !== undefined && api2.httpCode === 200 && api2.timeTotalSec > 0
  const marketplaceOk =
    marketplace !== undefined && marketplace.httpCode === 200 && marketplace.timeTotalSec > 0

  const errorParts: string[] = []
  if (stderr.trim()) {
    errorParts.push(stderr.trim())
  }
  if (!api2) {
    errorParts.push('missing api2 curl line')
  } else if (!api2Ok) {
    errorParts.push(`api2 code=${api2.httpCode} time=${api2.timeTotalSec}s`)
  }
  if (!marketplace) {
    errorParts.push('missing marketplace curl line')
  } else if (!marketplaceOk) {
    errorParts.push(`marketplace code=${marketplace.httpCode} time=${marketplace.timeTotalSec}s`)
  }

  return {
    region,
    sshHost,
    api2Ok,
    api2LatencyMs: api2Ok ? Math.round(api2.timeTotalSec * 1000) : -1,
    marketplaceOk,
    marketplaceLatencyMs: marketplaceOk ? Math.round(marketplace.timeTotalSec * 1000) : -1,
    authoritative: true,
    ...(api2Ok && marketplaceOk ? { probeAttribution: 'healthy' as const } : {}),
    ...(target
      ? { sshConnectHost: target.hostName, resolvedVia: target.resolvedVia }
      : {}),
    ...(errorParts.length > 0 ? { errorDetail: errorParts.join('; ') } : {})
  }
}

function buildPathErrorResult(
  sshHost: string,
  region: 'KR-VPS' | 'JP-VPS',
  probeAttribution: Exclude<VpsProbeAttribution, 'healthy'>,
  errorDetail: string
): VpsL4ProbeResult {
  return {
    region,
    sshHost,
    api2Ok: false,
    api2LatencyMs: -1,
    marketplaceOk: false,
    marketplaceLatencyMs: -1,
    authoritative: false,
    probeAttribution,
    errorDetail
  }
}

export async function runVpsL4ProbeViaSsh(
  sshHost: string,
  region: 'KR-VPS' | 'JP-VPS',
  leafProxies: unknown[] = []
): Promise<VpsL4ProbeResult> {
  try {
    const { stdout: sshGStdout } = await execFileAsync('ssh', ['-G', sshHost], {
      timeout: 5_000
    })
    const sshG = parseSshGOutput(sshGStdout)
    const target = resolveVpsSshTarget(sshHost, region, sshG, leafProxies)
    if (!target) {
      return buildPathErrorResult(
        sshHost,
        region,
        'ssh_target_unresolved',
        `ssh -G hostname=${sshG.hostName || '(empty)'}; no leaf proxy fallback for ${region}`
      )
    }

    const { stdout, stderr } = await execFileAsync(
      'ssh',
      buildVpsSshArgs(target, VPS_REMOTE_CURL),
      { timeout: (VPS_SSH_CONNECT_TIMEOUT_SEC + VPS_L4_CURL_TIMEOUT_SEC * 2 + 5) * 1000 }
    )
    return buildVpsL4ProbeResult(sshHost, region, stdout, stderr, target)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (detectFakeIpMisroute(message)) {
      return buildPathErrorResult(
        sshHost,
        region,
        'fake_ip_misroute',
        `SSH routed via fake-ip: ${message}`
      )
    }
    return {
      region,
      sshHost,
      api2Ok: false,
      api2LatencyMs: -1,
      marketplaceOk: false,
      marketplaceLatencyMs: -1,
      authoritative: true,
      errorDetail: message
    }
  }
}
