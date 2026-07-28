// [INPUT] marathonQuiesceCore · appendAppLog
// [OUTPUT] syncMarathonQuiesceIfNeeded · isMarathonQuiesceProxyHealthPaused · getMarathonQuiesceSnapshot
// [POS] P9 运行时状态机：hung_scan / probe_cycle 驱动 quiesce ON/OFF；纯内存，零数据面 mutation。

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

/** Advance quiesce state machine (memory-only; no runtime yaml or mihomo reload). */
export async function syncMarathonQuiesceIfNeeded(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<void> {
  lastObservedCursorConn = cursorConnectionCount
  const transition = advanceMarathonQuiesceState(cursorConnectionCount, quiesceState, nowMs)
  quiesceState = transition.state

  if (transition.entered) {
    await appendAppLog(
      `[MarathonQuiesce]: marathon_quiesce ON cursor_conn=${cursorConnectionCount} data_plane_action=none\n`,
    )
    await appendAppLog(
      `[MarathonQuiesce]: healthcheck_inflight_skipped scheduled_off=true cursor_conn=${cursorConnectionCount} data_plane_action=none\n`,
    )
  } else if (transition.exited) {
    await appendAppLog(
      `[MarathonQuiesce]: marathon_quiesce OFF cursor_conn=${cursorConnectionCount} data_plane_action=none\n`,
    )
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
