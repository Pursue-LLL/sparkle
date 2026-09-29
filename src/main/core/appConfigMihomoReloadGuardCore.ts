// [INPUT] marathonCoreRestartGuardCore SSOT
// [OUTPUT] shouldDeferAppConfigMihomoReload / shouldDeferProfileProviderReload
// [POS] P10-2 — hot reload defer uses the same decision as core cold restart (conn>0 / quiesce / lifecycle).

import {
  shouldBlockMarathonCoreColdRestart,
  type MarathonCoreRestartGuardSnapshot,
} from './marathonCoreRestartGuardCore'

export interface AppConfigMihomoReloadGuardSnapshot {
  quiesceActive: boolean
  cursorConnectionCount: number
  recentActiveLifecycleStreamCount: number
}

function toCoreRestartSnapshot(
  snapshot: AppConfigMihomoReloadGuardSnapshot,
  updatedAtMs = Date.now(),
): MarathonCoreRestartGuardSnapshot {
  return {
    quiesceActive: snapshot.quiesceActive,
    cursorConnectionCount: snapshot.cursorConnectionCount,
    recentActiveLifecycleStreamCount: snapshot.recentActiveLifecycleStreamCount,
    updatedAtMs,
  }
}

/** Same SSOT as core cold restart — any data-plane mutation during marathon is deferred. */
export function shouldDeferAppConfigMihomoReload(
  snapshot: AppConfigMihomoReloadGuardSnapshot,
): boolean {
  return shouldBlockMarathonCoreColdRestart(toCoreRestartSnapshot(snapshot), false).blocked
}

/** Profile provider hot-reload is connection-safe (existing connections keep their
 * outbound sockets; only new connections pick up the refreshed pool) — defer only
 * while marathon streams are actually in a protected lifecycle window, not merely
 * because Cursor has connections open. */
export function shouldDeferProfileProviderReload(
  snapshot: AppConfigMihomoReloadGuardSnapshot,
): boolean {
  if (snapshot.quiesceActive || snapshot.recentActiveLifecycleStreamCount > 0) {
    return true
  }
  return false
}

/** Shell scripts read ~/.sparkle/marathon-core-restart-guard.json — shared defer predicate. */
export function shouldDeferMihomoReloadFromGuardStateFile(payload: {
  blockColdRestart?: boolean
  cursorConnectionCount?: number
  recentActiveLifecycleStreamCount?: number
  quiesceActive?: boolean
}): boolean {
  if (payload.blockColdRestart === true) {
    return true
  }
  return shouldBlockMarathonCoreColdRestart(
    {
      quiesceActive: payload.quiesceActive === true,
      cursorConnectionCount:
        typeof payload.cursorConnectionCount === 'number' ? payload.cursorConnectionCount : -1,
      recentActiveLifecycleStreamCount:
        typeof payload.recentActiveLifecycleStreamCount === 'number'
          ? payload.recentActiveLifecycleStreamCount
          : -1,
      updatedAtMs: Date.now(),
    },
    false,
  ).blocked
}
