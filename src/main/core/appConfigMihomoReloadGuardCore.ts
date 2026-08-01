// [INPUT] marathon quiesce + core restart guard snapshot
// [OUTPUT] shouldDeferAppConfigMihomoReload
// [POS] P10-2 — block IPC app-config profile reload during marathon (no data-plane mutation bypass).

import { MARATHON_QUIESCE_ENTER_CONN_THRESHOLD } from './marathonQuiesceCore'

export interface AppConfigMihomoReloadGuardSnapshot {
  quiesceActive: boolean
  cursorConnectionCount: number
  recentActiveLifecycleStreamCount: number
}

export function shouldDeferAppConfigMihomoReload(
  snapshot: AppConfigMihomoReloadGuardSnapshot,
): boolean {
  if (snapshot.quiesceActive) {
    return true
  }
  if (snapshot.cursorConnectionCount >= MARATHON_QUIESCE_ENTER_CONN_THRESHOLD) {
    return true
  }
  if (snapshot.recentActiveLifecycleStreamCount > 0) {
    return true
  }
  return false
}
