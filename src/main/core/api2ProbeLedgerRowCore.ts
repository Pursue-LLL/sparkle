import type { ProbeAttribution } from './cursorTransportHealthCore'

export type Api2ProbeScope = 'active' | 'vps'
export type Api2ProbeMethod =
  | 'transport_pair'
  | 'mihomo_delay'
  | 'deferred'
  | 'on_demand'
  | 'defer_check'

export interface Api2ProbeLedgerRow {
  ts: string
  scope: Api2ProbeScope
  node: string
  region?: string
  kind?: 'vps' | 'commercial'
  latency_ms: number
  ok: boolean
  authoritative: boolean
  method: Api2ProbeMethod
  probe_attribution?: ProbeAttribution
  probe_via?: string
  marketplace_ok?: boolean
  marketplace_latency_ms?: number
  recovery_action?: string
  proxy_delay_ms?: number
  error_detail?: string
}

export function ledgerRowToBenchmarkSample(row: Api2ProbeLedgerRow): {
  ts: string
  node: string
  region: string
  kind: 'vps' | 'commercial'
  delay_ms: number
  ok: boolean
  probe_attribution?: ProbeAttribution
} {
  return {
    ts: row.ts,
    node: row.node,
    region: row.region ?? '',
    kind: row.kind ?? 'vps',
    delay_ms: row.latency_ms,
    ok: row.ok,
    ...(row.probe_attribution ? { probe_attribution: row.probe_attribution } : {})
  }
}

export function readApi2ProbeLedgerRowsSince(
  raw: string,
  sinceMs: number,
  scope?: Api2ProbeScope
): Api2ProbeLedgerRow[] {
  const rows: Api2ProbeLedgerRow[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as Api2ProbeLedgerRow
      if (scope !== undefined && row.scope !== scope) continue
      const ts = Date.parse(row.ts)
      if (!Number.isFinite(ts) || ts < sinceMs) continue
      rows.push(row)
    } catch {
      continue
    }
  }
  return rows
}
