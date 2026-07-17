import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const VPS_L4_PROBE_INTERVAL_MS = 300_000
export const VPS_SSH_CONNECT_TIMEOUT_SEC = 10
export const VPS_L4_CURL_TIMEOUT_SEC = 10

export const VPS_SSH_HOSTS = [
  { sshHost: 'kr-vps', region: 'KR-VPS' as const },
  { sshHost: 'jp-vps', region: 'JP-VPS' as const }
]

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
  errorDetail?: string
}

const VPS_REMOTE_CURL =
  "curl -o /dev/null -s -w 'api2 %{time_total} %{http_code}\\n' " +
  `--connect-timeout ${VPS_L4_CURL_TIMEOUT_SEC} https://api2.cursor.sh && ` +
  "curl -o /dev/null -s -w 'marketplace %{time_total} %{http_code}\\n' " +
  `--connect-timeout ${VPS_L4_CURL_TIMEOUT_SEC} https://marketplace.cursorapi.com`

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
  stderr: string
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
    ...(errorParts.length > 0 ? { errorDetail: errorParts.join('; ') } : {})
  }
}

export async function runVpsL4ProbeViaSsh(
  sshHost: string,
  region: 'KR-VPS' | 'JP-VPS'
): Promise<VpsL4ProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        `ConnectTimeout=${VPS_SSH_CONNECT_TIMEOUT_SEC}`,
        sshHost,
        VPS_REMOTE_CURL
      ],
      { timeout: (VPS_SSH_CONNECT_TIMEOUT_SEC + VPS_L4_CURL_TIMEOUT_SEC * 2 + 5) * 1000 }
    )
    return buildVpsL4ProbeResult(sshHost, region, stdout, stderr)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      region,
      sshHost,
      api2Ok: false,
      api2LatencyMs: -1,
      marketplaceOk: false,
      marketplaceLatencyMs: -1,
      errorDetail: message
    }
  }
}
