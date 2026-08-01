// [INPUT] marathonQuiesceCore thresholds
// [OUTPUT] Marathon core cold-restart guard pure functions
// [POS] SSOT: block Mihomo cold shutdown during marathon (quiesce active or conn≥12).

import { MARATHON_QUIESCE_ENTER_CONN_THRESHOLD } from './marathonQuiesceCore'

export const MARATHON_CORE_RESTART_FORCE_ENV = 'SPARKLE_FORCE_CORE_RESTART'

export type CoreLifecycleCaller =
  | 'stopCore'
  | 'restartCore'
  | 'install-sparkle-local'
  | 'upgrade-sparkle-local'

/** Block cold restart when recent userMessage segments exist (conn may briefly hit 0). */
export const MARATHON_CORE_RESTART_SEGMENT_LOOKBACK_MS = 30 * 60 * 1000

export interface MarathonCoreRestartGuardSnapshot {
  quiesceActive: boolean
  cursorConnectionCount: number
  /** P10-1 lifecycle journal — active non-terminal generations within lookback. */
  recentActiveLifecycleStreamCount: number
  updatedAtMs: number
}

export interface MarathonCoreRestartGuardDecision {
  blocked: boolean
  forceOverride: boolean
  reason: string
}

export function isMarathonCoreRestartForceOverride(
  envValue: string | undefined = process.env[MARATHON_CORE_RESTART_FORCE_ENV],
): boolean {
  return envValue === '1'
}

export function shouldBlockMarathonCoreColdRestart(
  snapshot: MarathonCoreRestartGuardSnapshot,
  forceOverride: boolean,
): MarathonCoreRestartGuardDecision {
  if (snapshot.cursorConnectionCount > 0) {
    return {
      blocked: true,
      forceOverride,
      reason: 'cursor_conn_active',
    }
  }

  if (forceOverride) {
    return {
      blocked: false,
      forceOverride: true,
      reason: 'force_override',
    }
  }

  if (snapshot.quiesceActive) {
    return {
      blocked: true,
      forceOverride: false,
      reason: 'marathon_quiesce_active',
    }
  }

  if (snapshot.recentActiveLifecycleStreamCount > 0) {
    return {
      blocked: true,
      forceOverride: false,
      reason: 'recent_active_lifecycle_stream',
    }
  }

  return {
    blocked: false,
    forceOverride: false,
    reason: 'idle',
  }
}

export function formatCoreLifecycleBlockedLog(
  caller: CoreLifecycleCaller,
  decision: MarathonCoreRestartGuardDecision,
  snapshot: MarathonCoreRestartGuardSnapshot,
): string {
  return (
    `[CoreLifecycle]: core_cold_restart_blocked caller=${caller} reason=${decision.reason} ` +
    `quiesce=${snapshot.quiesceActive ? '1' : '0'} cursor_conn=${snapshot.cursorConnectionCount}` +
    ` recent_active_lifecycle=${snapshot.recentActiveLifecycleStreamCount}\n`
  )
}

export function formatCoreLifecycleScheduledLog(
  caller: CoreLifecycleCaller,
  snapshot: MarathonCoreRestartGuardSnapshot,
): string {
  return (
    `[CoreLifecycle]: core_cold_restart_scheduled caller=${caller} ` +
    `quiesce=${snapshot.quiesceActive ? '1' : '0'} cursor_conn=${snapshot.cursorConnectionCount}` +
    ` recent_active_lifecycle=${snapshot.recentActiveLifecycleStreamCount}\n`
  )
}

export function buildMarathonCoreRestartGuardStateFilePayload(
  snapshot: MarathonCoreRestartGuardSnapshot,
  forceOverride: boolean,
): {
  updatedAtMs: number
  quiesceActive: boolean
  cursorConnectionCount: number
  recentActiveLifecycleStreamCount: number
  blockColdRestart: boolean
  forceOverride: boolean
  connThreshold: number
} {
  const decision = shouldBlockMarathonCoreColdRestart(snapshot, forceOverride)
  return {
    updatedAtMs: snapshot.updatedAtMs,
    quiesceActive: snapshot.quiesceActive,
    cursorConnectionCount: snapshot.cursorConnectionCount,
    recentActiveLifecycleStreamCount: snapshot.recentActiveLifecycleStreamCount,
    blockColdRestart: decision.blocked,
    forceOverride,
    connThreshold: MARATHON_QUIESCE_ENTER_CONN_THRESHOLD,
  }
}
