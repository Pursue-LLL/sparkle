import { appendAppLog } from '../utils/log'
import { resolveMarathonDialTimeoutSec } from './marathonDialToleranceCore'
import {
  resolveMarathonDialTolerancePendingTarget,
  shouldDeferMarathonDialToleranceApply,
} from './marathonDialToleranceIdleApplyCore'
import { resolveMarathonSSETruthNow } from './marathonSSETruthRuntime'

let lastAppliedDialTimeoutSec: number | undefined
let pendingDialTimeoutSec: number | undefined

async function resolveMarathonDialToleranceIdleContext(cursorConnectionCount: number): Promise<{
  marathonTruthActive: boolean
  quiesceActive: boolean
}> {
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  return {
    marathonTruthActive: truth.marathonTruthActive,
    quiesceActive: quiesceSnapshot.active,
  }
}

/** Track dial-timeout intent in memory only — never rewrite provider yaml or reload mihomo. */
export async function syncMarathonDialToleranceIfNeeded(
  cursorConnectionCount: number,
): Promise<boolean> {
  const targetDialTimeoutSec = resolveMarathonDialTimeoutSec(cursorConnectionCount)
  const { marathonTruthActive, quiesceActive } =
    await resolveMarathonDialToleranceIdleContext(cursorConnectionCount)
  const defer = shouldDeferMarathonDialToleranceApply(
    cursorConnectionCount,
    marathonTruthActive,
    quiesceActive,
  )

  pendingDialTimeoutSec = resolveMarathonDialTolerancePendingTarget(
    targetDialTimeoutSec,
    defer,
    pendingDialTimeoutSec,
  )

  if (defer) {
    if (pendingDialTimeoutSec != null && lastAppliedDialTimeoutSec !== pendingDialTimeoutSec) {
      await appendAppLog(
        `[MarathonDialTolerance]: memory_only_deferred cursor_conn=${cursorConnectionCount}` +
          ` target_timeout=${pendingDialTimeoutSec}s marathon_truth_active=${marathonTruthActive ? 1 : 0}` +
          ` quiesce=${quiesceActive ? 1 : 0} data_plane_action=none\n`,
      )
    }
    return false
  }

  if (lastAppliedDialTimeoutSec !== targetDialTimeoutSec) {
    await appendAppLog(
      `[MarathonDialTolerance]: memory_only_skip cursor_conn=${cursorConnectionCount}` +
        ` target_timeout=${targetDialTimeoutSec}s data_plane_action=none\n`,
    )
    lastAppliedDialTimeoutSec = targetDialTimeoutSec
    pendingDialTimeoutSec = undefined
  }
  return false
}

export function resetMarathonDialToleranceStateForTests(): void {
  lastAppliedDialTimeoutSec = undefined
  pendingDialTimeoutSec = undefined
}
