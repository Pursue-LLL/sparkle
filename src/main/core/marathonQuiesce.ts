// [INPUT] marathonQuiesceCore · factory · mihomoApi · appendAppLog
// [OUTPUT] syncMarathonQuiesceIfNeeded · isMarathonQuiesceProxyHealthPaused · getMarathonQuiesceSnapshot
// [POS] P9 + R-24 CB-3：conn≥12 quiesce ON/OFF；health-check.enable 热 patch + mihomo reload。

import { appendAppLog } from '../utils/log'
import {
  advanceMarathonQuiesceState,
  createInitialMarathonQuiesceState,
  isMarathonQuiesceActive,
  type MarathonQuiesceState,
} from './marathonQuiesceCore'

let quiesceState: MarathonQuiesceState = createInitialMarathonQuiesceState()
let lastObservedCursorConn = 0

export function resetMarathonQuiesceStateForTests(): void {
  quiesceState = createInitialMarathonQuiesceState()
  lastObservedCursorConn = 0
}

export function getMarathonQuiesceSnapshot(): {
  active: boolean
  cursorConnectionCount: number
} {
  return {
    active: isMarathonQuiesceActive(quiesceState),
    cursorConnectionCount: lastObservedCursorConn,
  }
}

export function isMarathonQuiesceProxyHealthPaused(): boolean {
  return isMarathonQuiesceActive(quiesceState)
}

async function applyMarathonQuiesceHealthCheckPatch(
  enable: boolean,
  cursorConnectionCount: number,
): Promise<void> {
  try {
    const { getProfileConfig, getAppConfig } = await import('../config')
    const { patchRuntimeProxyProviderHealthCheckEnable } = await import('./factory')
    const { reloadMihomoConfigFromDisk } = await import('./mihomoApi')
    const { current } = await getProfileConfig()
    const { diffWorkDir = false } = await getAppConfig()
    const changed = await patchRuntimeProxyProviderHealthCheckEnable(current, enable, diffWorkDir)
    if (changed) {
      await reloadMihomoConfigFromDisk()
    }
    await appendAppLog(
      `[MarathonQuiesce]: health_check_enable=${enable ? 1 : 0}` +
        ` cursor_conn=${cursorConnectionCount}` +
        ` data_plane_action=${changed ? 'reload' : 'none'}\n`,
    )
  } catch (error) {
    const { formatUnknownErrorForLog } = await import('../utils/formatUnknownErrorForLog')
    await appendAppLog(
      `[MarathonQuiesce]: health_check_patch_failed enable=${enable ? 1 : 0}` +
        ` cursor_conn=${cursorConnectionCount}` +
        ` err=${formatUnknownErrorForLog(error)}\n`,
    )
  }
}

/** Advance quiesce state machine; R-24 disables mihomo provider lazy health-check while active. */
export async function syncMarathonQuiesceIfNeeded(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<void> {
  lastObservedCursorConn = cursorConnectionCount
  const transition = advanceMarathonQuiesceState(cursorConnectionCount, quiesceState, nowMs)
  quiesceState = transition.state

  if (transition.entered) {
    await appendAppLog(
      `[MarathonQuiesce]: marathon_quiesce ON cursor_conn=${cursorConnectionCount}\n`,
    )
    await applyMarathonQuiesceHealthCheckPatch(false, cursorConnectionCount)
  } else if (transition.exited) {
    await appendAppLog(
      `[MarathonQuiesce]: marathon_quiesce OFF cursor_conn=${cursorConnectionCount}\n`,
    )
    await applyMarathonQuiesceHealthCheckPatch(true, cursorConnectionCount)
  }

  await refreshMarathonCoreRestartGuardStateAfterQuiesce(cursorConnectionCount)
}

async function refreshMarathonCoreRestartGuardStateAfterQuiesce(
  cursorConnectionCount: number,
): Promise<void> {
  const { refreshMarathonCoreRestartGuardStateFile } = await import('./marathonCoreRestartGuard')
  await refreshMarathonCoreRestartGuardStateFile({
    quiesceActive: isMarathonQuiesceActive(quiesceState),
    cursorConnectionCount,
    updatedAtMs: Date.now(),
  })
}
