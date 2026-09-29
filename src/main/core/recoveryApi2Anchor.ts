// [INPUT] recoveryApi2AnchorCore · cursorDedicatedNodeResolver · cursorTransportHealth
// [OUTPUT] probeRecoveryApi2Anchor · probeRecoveryApi2AnchorDetailed
// [POS] BUG-2026-09-03-012 D1 — api2 anchor via Cursor dedicated leaf (not mixed-port :7890).

import type { RecoveryApi2AnchorProbeVia } from './recoveryApi2AnchorCore'

export interface RecoveryApi2AnchorDetailedResult {
  ok: boolean
  leaf?: string
  latencyMs?: number
  errorDetail?: string
  probeVia: RecoveryApi2AnchorProbeVia
}

let testRecoveryApi2AnchorOverride:
  | ((maxWaitMs: number) => Promise<RecoveryApi2AnchorDetailedResult>)
  | null = null

export function setRecoveryApi2AnchorOverrideForTests(
  override: typeof testRecoveryApi2AnchorOverride,
): void {
  testRecoveryApi2AnchorOverride = override
}

export function resetRecoveryApi2AnchorForTests(): void {
  testRecoveryApi2AnchorOverride = null
}

async function probeRecoveryApi2MixedPortFallback(
  maxWaitMs: number,
): Promise<RecoveryApi2AnchorDetailedResult> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const timeoutSec = String(Math.max(3, Math.ceil(maxWaitMs / 1000)))
  const startedAt = Date.now()
  try {
    await execFileAsync('curl', [
      '-sf',
      '--max-time',
      timeoutSec,
      '-x',
      'http://127.0.0.1:7890',
      'https://api2.cursor.sh/',
    ])
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      probeVia: 'mixed_port_fallback',
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorDetail: error instanceof Error ? error.message : String(error),
      probeVia: 'mixed_port_fallback',
    }
  }
}

async function recordAnchorSuccessToLedger(result: RecoveryApi2AnchorDetailedResult): Promise<void> {
  if (!result.ok) return
  try {
    const { appendApi2ProbeLedgerRow } = await import('./api2ProbeLedgerCore')
    await appendApi2ProbeLedgerRow({
      ts: new Date().toISOString(),
      scope: 'active',
      node: result.leaf ?? 'mixed_port',
      latency_ms: result.latencyMs ?? 0,
      ok: true,
      authoritative: true,
      method: 'on_demand',
      probe_via: result.probeVia,
    })
  } catch {
    // Non-blocking best-effort ledger recording
  }
}

export async function probeRecoveryApi2AnchorDetailed(
  maxWaitMs: number = 10_000,
): Promise<RecoveryApi2AnchorDetailedResult> {
  if (testRecoveryApi2AnchorOverride) {
    return testRecoveryApi2AnchorOverride(maxWaitMs)
  }
  const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
  const leaf = (await resolveCursorDedicatedActiveNode())?.trim()
  if (leaf) {
    let probe: { ok: boolean; latencyMs: number; errorDetail?: string }
    try {
      const { probeApi2ViaMihomoNode } = await import('./cursorApi2MihomoProbe')
      if (typeof probeApi2ViaMihomoNode !== 'function') {
        throw new Error('probeApi2ViaMihomoNode_unavailable')
      }
      probe = await probeApi2ViaMihomoNode(leaf)
    } catch (error) {
      const fallback = await probeRecoveryApi2MixedPortFallback(maxWaitMs)
      const res: RecoveryApi2AnchorDetailedResult = {
        ...fallback,
        leaf,
        errorDetail:
          (error instanceof Error ? error.message : String(error)) +
          (fallback.errorDetail ? `; fallback=${fallback.errorDetail}` : ''),
        probeVia: 'mixed_port_fallback',
      }
      if (res.ok) {
        await recordAnchorSuccessToLedger(res)
      }
      return res
    }
    if (probe.ok) {
      const res: RecoveryApi2AnchorDetailedResult = {
        ok: true,
        leaf,
        latencyMs: probe.latencyMs,
        probeVia: 'cursor_dedicated_mihomo',
      }
      await recordAnchorSuccessToLedger(res)
      return res
    }
    const fallback = await probeRecoveryApi2MixedPortFallback(maxWaitMs)
    if (fallback.ok) {
      const res: RecoveryApi2AnchorDetailedResult = {
        ...fallback,
        leaf,
        errorDetail: probe.errorDetail,
        probeVia: 'mixed_port_fallback',
      }
      await recordAnchorSuccessToLedger(res)
      return res
    }
    return {
      ok: false,
      leaf,
      latencyMs: probe.latencyMs,
      errorDetail: probe.errorDetail,
      probeVia: 'cursor_dedicated_mihomo',
    }
  }
  const directFallback = await probeRecoveryApi2MixedPortFallback(maxWaitMs)
  if (directFallback.ok) {
    await recordAnchorSuccessToLedger(directFallback)
  }
  return directFallback
}

export async function probeRecoveryApi2Anchor(maxWaitMs: number = 10_000): Promise<boolean> {
  const result = await probeRecoveryApi2AnchorDetailed(maxWaitMs)
  return result.ok
}
