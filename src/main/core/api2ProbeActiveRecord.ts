import type { ProbeAttribution } from './cursorTransportHealthCore'
import type { ProbePairResult } from './cursorTransportHealthCore'
import { isTransportPairHealthy } from './cursorTransportHealthCore'
import { appendApi2ProbeLedgerRow } from './api2ProbeLedgerCore'
import type { Api2ProbeMethod } from './api2ProbeLedgerRowCore'

export interface ActiveApi2ProbeRecordInput {
  method: Api2ProbeMethod
  authoritative: boolean
  probe: ProbePairResult
  proxyNode: string
  probeVia?: string
  proxyDelayMs?: number
  attribution?: ProbeAttribution
  recoveryAction?: string
  errorDetail?: string
}

export async function recordActiveApi2ProbeToLedger(
  input: ActiveApi2ProbeRecordInput
): Promise<void> {
  await appendApi2ProbeLedgerRow({
    ts: new Date().toISOString(),
    scope: 'active',
    node: input.proxyNode,
    latency_ms: input.probe.api2LatencyMs,
    ok: isTransportPairHealthy(input.probe),
    authoritative: input.authoritative,
    method: input.method,
    ...(input.attribution ? { probe_attribution: input.attribution } : {}),
    ...(input.probeVia ? { probe_via: input.probeVia } : {}),
    ...(input.proxyDelayMs !== undefined ? { proxy_delay_ms: input.proxyDelayMs } : {}),
    ...(input.recoveryAction ? { recovery_action: input.recoveryAction } : {}),
    marketplace_ok: input.probe.marketplaceOk,
    marketplace_latency_ms: input.probe.marketplaceLatencyMs,
    ...(input.errorDetail ? { error_detail: input.errorDetail } : {})
  })
}
