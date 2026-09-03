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

export async function probeRecoveryApi2AnchorDetailed(
  maxWaitMs: number = 10_000,
): Promise<RecoveryApi2AnchorDetailedResult> {
  if (testRecoveryApi2AnchorOverride) {
    return testRecoveryApi2AnchorOverride(maxWaitMs)
  }
  const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
  const leaf = (await resolveCursorDedicatedActiveNode())?.trim()
  if (leaf) {
    const { probeApi2ViaMihomoNode } = await import('./cursorTransportHealth')
    const probe = await probeApi2ViaMihomoNode(leaf)
    if (probe.ok) {
      return {
        ok: true,
        leaf,
        latencyMs: probe.latencyMs,
        probeVia: 'cursor_dedicated_mihomo',
      }
    }
    return {
      ok: false,
      leaf,
      latencyMs: probe.latencyMs,
      errorDetail: probe.errorDetail,
      probeVia: 'cursor_dedicated_mihomo',
    }
  }
  return probeRecoveryApi2MixedPortFallback(maxWaitMs)
}

export async function probeRecoveryApi2Anchor(maxWaitMs: number = 10_000): Promise<boolean> {
  const result = await probeRecoveryApi2AnchorDetailed(maxWaitMs)
  return result.ok
}
