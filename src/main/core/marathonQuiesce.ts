// [INPUT] marathonQuiesceCore · factory · mihomoApi · appendAppLog
// [OUTPUT] syncMarathonQuiesceIfNeeded · isMarathonQuiesceProxyHealthPaused · getMarathonQuiesceSnapshot
// [POS] P9 + P10-2：conn≥12 quiesce ON/OFF；runtime yaml 持久化 health-check.enable，禁止 mihomo reload。

import { getProfileConfig } from '../config'
import { getAppConfig } from '../config/app'
import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import { appendAppLog } from '../utils/log'
import {
  patchRuntimeProxyProviderHealthCheckEnable,
} from './factory'
import {
  advanceMarathonQuiesceState,
  createInitialMarathonQuiesceState,
  isMarathonQuiesceActive,
  type MarathonQuiesceState,
} from './marathonQuiesceCore'
import { refreshMarathonCoreRestartGuardStateFile } from './marathonCoreRestartGuard'

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
    const { current } = await getProfileConfig()
    const { diffWorkDir = false } = await getAppConfig()
    const changed = await patchRuntimeProxyProviderHealthCheckEnable(current, enable, diffWorkDir)
    await appendAppLog(
      `[MarathonQuiesce]: health_check_enable=${enable ? 1 : 0}` +
        ` cursor_conn=${cursorConnectionCount}` +
        ` data_plane_action=${changed ? 'yaml_persist_only' : 'none'}` +
        ` reload=0\n`,
    )
  } catch (error) {
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
  const previousConn = lastObservedCursorConn
  lastObservedCursorConn = cursorConnectionCount
  const transition = advanceMarathonQuiesceState(cursorConnectionCount, quiesceState, nowMs)
  quiesceState = transition.state

  if (previousConn === 0 && cursorConnectionCount > 0) {
    const { resolveCursorDedicatedActiveNode } = await import('./cursorHy2MarathonKeepalive')
    const activeNode = await resolveCursorDedicatedActiveNode()
    if (activeNode) {
      const { notifyMarathonStartedOnSuboptimalLeafIfNeeded } = await import(
        './marathonProtocolContract'
      )
      await notifyMarathonStartedOnSuboptimalLeafIfNeeded(cursorConnectionCount, activeNode)
    }
  }

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
  await refreshMarathonCoreRestartGuardStateFile({
    quiesceActive: isMarathonQuiesceActive(quiesceState),
    cursorConnectionCount,
    updatedAtMs: Date.now(),
  })
}
