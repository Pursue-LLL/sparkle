import { appendAppLog } from '../utils/log'
import { appendApi2ProbeLedgerRow } from './api2ProbeLedgerCore'
import {
  runVpsL4ProbeViaSsh,
  VPS_L4_PROBE_INTERVAL_MS,
  VPS_SSH_HOSTS,
  type VpsL4ProbeResult
} from './vpsL4ProbeCore'

let lastVpsL4ProbeAtMs = 0
let vpsL4ProbeInFlight = false

function resultToLedgerRow(result: VpsL4ProbeResult) {
  return {
    ts: new Date().toISOString(),
    scope: 'vps' as const,
    node: result.region,
    region: result.region.replace('-VPS', ''),
    kind: 'vps' as const,
    latency_ms: result.api2LatencyMs,
    ok: result.api2Ok,
    authoritative: true,
    method: 'ssh_curl' as const,
    probe_via: `ssh:${result.sshHost}`,
    marketplace_ok: result.marketplaceOk,
    marketplace_latency_ms: result.marketplaceLatencyMs,
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
    const results: VpsL4ProbeResult[] = []
    for (const host of VPS_SSH_HOSTS) {
      const result = await runVpsL4ProbeViaSsh(host.sshHost, host.region)
      results.push(result)
      await appendApi2ProbeLedgerRow(resultToLedgerRow(result))
      await appendAppLog(
        `[VpsL4Probe]: ${result.region} ssh=${result.sshHost} api2_ok=${result.api2Ok} api2_ms=${result.api2LatencyMs} marketplace_ok=${result.marketplaceOk}${result.errorDetail ? ` err=${result.errorDetail}` : ''}\n`
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
