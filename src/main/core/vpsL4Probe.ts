import { appendAppLog } from '../utils/log'
import { getProfileConfig } from '../config'
import { getProfile } from '../config/profile'
import { appendApi2ProbeLedgerRow } from './api2ProbeLedgerCore'
import { extractProxies } from './provider'
import {
  runVpsL4ProbeViaSsh,
  VPS_L4_PROBE_INTERVAL_MS,
  VPS_SSH_HOSTS,
  type VpsL4ProbeResult,
  type VpsProbeAttribution
} from './vpsL4ProbeCore'

let lastVpsL4ProbeAtMs = 0
let vpsL4ProbeInFlight = false

async function loadLeafProxiesForVpsProbe(): Promise<unknown[]> {
  const { current } = await getProfileConfig()
  const profile = await getProfile(current)
  return extractProxies(profile)
}

function isPathProbeAttribution(
  attribution: VpsProbeAttribution | undefined
): attribution is 'ssh_target_unresolved' | 'fake_ip_misroute' {
  return attribution === 'ssh_target_unresolved' || attribution === 'fake_ip_misroute'
}

function resultToLedgerRow(result: VpsL4ProbeResult) {
  const pathError = isPathProbeAttribution(result.probeAttribution)
  const probeVia = result.sshConnectHost
    ? `ssh:${result.sshHost}@${result.sshConnectHost}`
    : `ssh:${result.sshHost}`

  return {
    ts: new Date().toISOString(),
    scope: 'vps' as const,
    node: result.region,
    region: result.region.replace('-VPS', ''),
    kind: 'vps' as const,
    latency_ms: result.api2LatencyMs,
    ok: result.api2Ok,
    authoritative: pathError ? false : result.authoritative,
    method: 'ssh_curl' as const,
    probe_via: probeVia,
    marketplace_ok: result.marketplaceOk,
    marketplace_latency_ms: result.marketplaceLatencyMs,
    ...(result.probeAttribution ? { probe_attribution: result.probeAttribution } : {}),
    error_detail: result.errorDetail
  }
}

export function shouldRunVpsL4ProbeCycle(nowMs: number = Date.now()): boolean {
  return nowMs - lastVpsL4ProbeAtMs >= VPS_L4_PROBE_INTERVAL_MS
}

export async function runVpsL4ProbeBatch(): Promise<VpsL4ProbeResult[]> {
  if (vpsL4ProbeInFlight) {
    return []
  }
  vpsL4ProbeInFlight = true
  try {
    const leafProxies = await loadLeafProxiesForVpsProbe()
    const results: VpsL4ProbeResult[] = []
    for (const host of VPS_SSH_HOSTS) {
      const result = await runVpsL4ProbeViaSsh(host.sshHost, host.region, leafProxies)
      results.push(result)
      await appendApi2ProbeLedgerRow(resultToLedgerRow(result))
      await appendAppLog(
        `[VpsL4Probe]: ${result.region} ssh=${result.sshHost}` +
          `${result.sshConnectHost ? `@${result.sshConnectHost}` : ''}` +
          ` via=${result.resolvedVia ?? 'n/a'} auth=${result.authoritative}` +
          ` attr=${result.probeAttribution ?? 'n/a'} api2_ok=${result.api2Ok}` +
          ` api2_ms=${result.api2LatencyMs} marketplace_ok=${result.marketplaceOk}` +
          `${result.errorDetail ? ` err=${result.errorDetail}` : ''}\n`
      )
    }
    lastVpsL4ProbeAtMs = Date.now()
    return results
  } finally {
    vpsL4ProbeInFlight = false
  }
}

export async function maybeRunVpsL4ProbeCycle(nowMs: number = Date.now()): Promise<void> {
  if (!shouldRunVpsL4ProbeCycle(nowMs)) {
    return
  }
  await runVpsL4ProbeBatch()
}

export function resetVpsL4ProbeScheduleForTests(): void {
  lastVpsL4ProbeAtMs = 0
  vpsL4ProbeInFlight = false
}
