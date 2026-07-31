// [INPUT] hy2TunnelVitalityCore · mihomoApi · CONNECT_PATH probe target
// [OUTPUT] runHy2TunnelVitalityIfDue
// [POS] P27 executor — lightweight connect_path dial on active HY2 leaf (no provider reload).

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { CONNECT_PATH_PROBE_TARGET } from './cursorConnectStreamKeepaliveCore'
import type { MarathonSSETruthResult } from './marathonSSETruthCore'
import {
  formatHy2TunnelVitalityLogLine,
  isHy2TunnelVitalityPrePartitionRisk,
  resolveHy2TunnelVitalitySkipReason,
  shouldRunHy2TunnelVitality,
  type Hy2TunnelVitalityResult,
} from './hy2TunnelVitalityCore'
import { HY2_PARENT_SIDECAR_DIAL_AGE_MS } from './hy2ParentSidecarCore'
import { isHy2SessionDialInFlight } from './marathonSessionDialExecutorCore'

let lastHy2TunnelVitalityAtMs = 0
let hy2TunnelVitalityInFlight = false

let testHy2TunnelVitalityDialOverride:
  | ((activeNode: string) => Promise<{ delay?: number; message?: string }>)
  | null = null

let skipHy2TunnelVitalityAppLogForTests = false

export function setSkipHy2TunnelVitalityAppLogForTests(skip: boolean): void {
  skipHy2TunnelVitalityAppLogForTests = skip
}

async function appendVitalityAppLog(line: string): Promise<void> {
  if (skipHy2TunnelVitalityAppLogForTests) {
    return
  }
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

export function setHy2TunnelVitalityDialOverrideForTests(
  override: typeof testHy2TunnelVitalityDialOverride,
): void {
  testHy2TunnelVitalityDialOverride = override
}

export function getLastHy2TunnelVitalityAtMs(): number {
  return lastHy2TunnelVitalityAtMs
}

export function getLastHy2TunnelVitalityAtMsForTests(): number {
  return lastHy2TunnelVitalityAtMs
}

export function resetHy2TunnelVitalityStateForTests(): void {
  lastHy2TunnelVitalityAtMs = 0
  hy2TunnelVitalityInFlight = false
  testHy2TunnelVitalityDialOverride = null
  skipHy2TunnelVitalityAppLogForTests = false
}

export interface RunHy2TunnelVitalityOptions {
  /** R-33: allow vitality during byte-frozen stall before parent chain reaches marathon age. */
  stallRecoveryBypass?: boolean
  /** R-35a: proactive parent sidecar dial — bypass not_due interval when session aged. */
  sidecarDial?: boolean
}

export async function runHy2TunnelVitalityIfDue(
  activeNode: string,
  cursorConnectionCount: number,
  nowMs: number,
  truth: MarathonSSETruthResult,
  options: RunHy2TunnelVitalityOptions = {},
): Promise<Hy2TunnelVitalityResult> {
  const gate: Parameters<typeof shouldRunHy2TunnelVitality>[0] = {
    nowMs,
    cursorConnectionCount,
    lastVitalityAtMs: lastHy2TunnelVitalityAtMs,
    activeNode,
    marathonTruthActive: truth.marathonTruthActive,
    maxParentChainAgeMs: truth.maxParentChainAgeMs,
    stallRecoveryBypass: options.stallRecoveryBypass,
  }

  const prePartitionRisk = isHy2TunnelVitalityPrePartitionRisk(gate)
  const sidecarForce =
    options.sidecarDial === true &&
    gate.marathonTruthActive &&
    gate.maxParentChainAgeMs >= HY2_PARENT_SIDECAR_DIAL_AGE_MS

  if (!shouldRunHy2TunnelVitality(gate) && !sidecarForce) {
    const skipReason = resolveHy2TunnelVitalitySkipReason(gate)
    if (
      skipReason &&
      skipReason !== 'skipped_not_due' &&
      skipReason !== 'skipped_no_quic_node'
    ) {
      await appendVitalityAppLog(
        formatHy2TunnelVitalityLogLine({
          outcome: skipReason,
          cursorConnectionCount,
          node: activeNode,
          maxParentChainAgeMs: truth.maxParentChainAgeMs,
          prePartitionRisk,
        }),
      )
    }
    return { outcome: skipReason ?? 'skipped_not_due' }
  }

  if (isHy2SessionDialInFlight() || hy2TunnelVitalityInFlight) {
    return { outcome: 'skipped_in_flight' }
  }

  hy2TunnelVitalityInFlight = true
  try {
    let connectPathDelayMs = 0
    if (testHy2TunnelVitalityDialOverride) {
      const delayResult = await testHy2TunnelVitalityDialOverride(activeNode)
      connectPathDelayMs = typeof delayResult.delay === 'number' ? delayResult.delay : 0
    } else {
      const { mihomoProxyDelay } = await import('./mihomoApi')
      const delayResult = await mihomoProxyDelay(activeNode, CONNECT_PATH_PROBE_TARGET, {
        purpose: 'hy2_tunnel_vitality',
        timeoutMs: 8_000,
      })
      connectPathDelayMs = typeof delayResult.delay === 'number' ? delayResult.delay : 0
    }
    lastHy2TunnelVitalityAtMs = nowMs
    let outboundHy2SessionAgeMs: number | undefined
    try {
      const { readTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
      const longevity = await readTransportLongevityTruthSnapshot()
      outboundHy2SessionAgeMs = longevity?.outboundHy2SessionAgeMs
    } catch {
      outboundHy2SessionAgeMs = undefined
    }
    await appendVitalityAppLog(
      formatHy2TunnelVitalityLogLine({
        outcome: 'executed',
        cursorConnectionCount,
        node: activeNode,
        connectPathDelayMs,
        maxParentChainAgeMs: truth.maxParentChainAgeMs,
        outboundHy2SessionAgeMs,
        prePartitionRisk,
      }),
    )
    return { outcome: 'executed', connectPathDelayMs }
  } catch (error) {
    const err = formatUnknownErrorForLog(error)
    await appendVitalityAppLog(
      formatHy2TunnelVitalityLogLine({
        outcome: 'failed',
        cursorConnectionCount,
        node: activeNode,
        maxParentChainAgeMs: truth.maxParentChainAgeMs,
        prePartitionRisk,
        err,
      }),
    )
    const { recoverMihomoApiAfterNudgeFailure } = await import('./mihomoApiSocketWatchdog')
    await recoverMihomoApiAfterNudgeFailure(error)
    return { outcome: 'failed', err }
  } finally {
    hy2TunnelVitalityInFlight = false
  }
}
