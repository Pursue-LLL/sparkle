// [INPUT] cursorHy2MarathonKeepaliveCore · marathonDialToleranceCore · cursorTransportHealthCore
// [OUTPUT] Marathon quiesce thresholds · probe/keepalive gate pure functions
// [POS] P9 SSOT: conn≥12/80 Marathon 静默门槛与 mandatory/burst/UI 过滤决策链。

import { CURSOR_HY2_NUDGE_DEFER_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import { MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD } from './marathonDialToleranceCore'
import type { MandatoryProbeContext } from './cursorTransportHealthCore'
import { shouldForceMandatoryRealProbe } from './cursorTransportHealthCore'

/** Enter Marathon quiesce when cursor_conn reaches this (SSOT — same as dial-tolerance). */
export const MARATHON_QUIESCE_ENTER_CONN_THRESHOLD = MARATHON_DIAL_TOLERANCE_CONN_THRESHOLD

/** Block mandatory/burst probes and P8 connect keepalive above this cursor_conn. */
export const MARATHON_QUIESCE_HEAVY_CONN_THRESHOLD = CURSOR_HY2_NUDGE_DEFER_THRESHOLD

/** Hold quiesce after cursor_conn drops below enter threshold before restoring probes. */
export const MARATHON_QUIESCE_EXIT_HYSTERESIS_MS = 60_000

export interface MarathonQuiesceState {
  active: boolean
  belowThresholdSinceMs: number | null
}

export interface MarathonQuiesceTransition {
  state: MarathonQuiesceState
  entered: boolean
  exited: boolean
}

export function createInitialMarathonQuiesceState(): MarathonQuiesceState {
  return { active: false, belowThresholdSinceMs: null }
}

export function shouldEnterMarathonQuiesce(cursorConnectionCount: number): boolean {
  return cursorConnectionCount >= MARATHON_QUIESCE_ENTER_CONN_THRESHOLD
}

export function isMarathonQuiesceActive(state: MarathonQuiesceState): boolean {
  return state.active
}

export function advanceMarathonQuiesceState(
  cursorConnectionCount: number,
  state: MarathonQuiesceState,
  nowMs: number = Date.now(),
): MarathonQuiesceTransition {
  if (cursorConnectionCount >= MARATHON_QUIESCE_ENTER_CONN_THRESHOLD) {
    if (!state.active) {
      return {
        state: { active: true, belowThresholdSinceMs: null },
        entered: true,
        exited: false,
      }
    }
    return {
      state: { active: true, belowThresholdSinceMs: null },
      entered: false,
      exited: false,
    }
  }

  if (!state.active) {
    return { state, entered: false, exited: false }
  }

  const belowSinceMs = state.belowThresholdSinceMs ?? nowMs
  if (nowMs - belowSinceMs >= MARATHON_QUIESCE_EXIT_HYSTERESIS_MS) {
    return {
      state: { active: false, belowThresholdSinceMs: null },
      entered: false,
      exited: true,
    }
  }

  return {
    state: { active: true, belowThresholdSinceMs: belowSinceMs },
    entered: false,
    exited: false,
  }
}

export function shouldPauseProxyHealthMonitorUnderQuiesce(quiesceActive: boolean): boolean {
  return quiesceActive
}

export function shouldDeferConnectStreamKeepaliveUnderQuiesce(
  cursorConnectionCount: number,
): boolean {
  return cursorConnectionCount >= MARATHON_QUIESCE_HEAVY_CONN_THRESHOLD
}

/** Mandatory real probe + burst must not pierce defer when cursor_conn is at heavy threshold. */
export function shouldForceMandatoryRealProbeUnderMarathonQuiesce(
  quiesceActive: boolean,
  context: MandatoryProbeContext,
): boolean {
  if (context.tunInterfaceLostLatched) {
    return shouldForceMandatoryRealProbe(context)
  }
  if (quiesceActive) {
    return false
  }
  if (context.cursorConnectionCount >= MARATHON_QUIESCE_HEAVY_CONN_THRESHOLD) {
    return false
  }
  return shouldForceMandatoryRealProbe(context)
}

export function shouldDeferProbeForCursorLoadUnderMarathonQuiesce(
  quiesceActive: boolean,
  cursorConnectionCount: number,
  context: MandatoryProbeContext,
): boolean {
  if (context.tunInterfaceLostLatched) {
    return false
  }
  if (quiesceActive) {
    return true
  }
  if (cursorConnectionCount >= MARATHON_QUIESCE_HEAVY_CONN_THRESHOLD) {
    return true
  }
  if (cursorConnectionCount < 20) {
    return false
  }
  return !shouldForceMandatoryRealProbeUnderMarathonQuiesce(false, context)
}

export type ObservabilityDialKind =
  | 'provider_healthcheck_api'
  | 'probe_cycle_transport'
  | 'regional_url_test_warmup'
  | 'marketplace_probe'
  | 'managed_ui_delay_test'
  | 'tray_manual_delay_test'
  | 'network_triangulation'
  | 'proxy_health_monitor'

/** P9 Phase 2 SSOT: block non-production dials while Marathon quiesce is active (incl. exit hysteresis). */
export function shouldAllowObservabilityDial(
  kind: ObservabilityDialKind,
  quiesceActive: boolean,
  _cursorConnectionCount: number,
): boolean {
  if (!quiesceActive) {
    return true
  }
  switch (kind) {
    case 'managed_ui_delay_test':
    case 'tray_manual_delay_test':
    case 'network_triangulation':
    case 'proxy_health_monitor':
      return true
    case 'provider_healthcheck_api':
    case 'probe_cycle_transport':
    case 'regional_url_test_warmup':
    case 'marketplace_probe':
      return false
    default:
      return false
  }
}

export function isBurstProbeActiveUnderMarathonQuiesce(
  burstUntilMs: number,
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): boolean {
  if (cursorConnectionCount >= MARATHON_QUIESCE_HEAVY_CONN_THRESHOLD) {
    return false
  }
  return nowMs < burstUntilMs
}

export function filterProxyDelayHistoryForMarathonDisplay<
  T extends { delay: number },
>(history: readonly T[]): T[] {
  if (history.length === 0) {
    return []
  }
  const hasTimeoutSample = history.some((entry) => entry.delay === 0)
  if (!hasTimeoutSample) {
    return [...history]
  }
  const successful = history.filter((entry) => entry.delay > 0)
  return successful.length > 0 ? successful : [...history]
}

export function shouldShowMarathonQuiesceDelayBadge<
  T extends { delay: number },
>(history: readonly T[]): boolean {
  if (history.length === 0) {
    return false
  }
  const hasTimeoutSample = history.some((entry) => entry.delay === 0)
  const hasSuccessfulSample = history.some((entry) => entry.delay > 0)
  return hasTimeoutSample && hasSuccessfulSample
}
