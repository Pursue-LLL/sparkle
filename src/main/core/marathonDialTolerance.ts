import { appendAppLog } from '../utils/log'
import { resolveMarathonDialTimeoutSec } from './marathonDialToleranceCore'
import {
  resolveMarathonDialTolerancePendingTarget,
  shouldDeferMarathonDialToleranceApply,
} from './marathonDialToleranceIdleApplyCore'
import {
  MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  MTDO_MARATHON_STREAM_MIN_AGE_MS,
} from './marathonTransportDialOrchestratorCore'
import { buildMarathonStreamRegistry, hasActiveMarathonStream } from './marathonStreamRegistryCore'
import {
  collectRendererActivitySamplesForMtdo,
  collectRendererToolAuditLinesForMtdo,
} from './marathonTransportDialReader'

let lastAppliedDialTimeoutSec: number | undefined
let pendingDialTimeoutSec: number | undefined

async function resolveMarathonDialToleranceIdleContext(cursorConnectionCount: number): Promise<{
  hasActiveMarathonStream: boolean
  quiesceActive: boolean
}> {
  const nowMs = Date.now()
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const [activitySamples, toolLines] = await Promise.all([
    collectRendererActivitySamplesForMtdo(nowMs),
    collectRendererToolAuditLinesForMtdo(nowMs),
  ])
  const registry = buildMarathonStreamRegistry(
    activitySamples,
    toolLines,
    nowMs,
    MTDO_ACTIVE_STREAM_MAX_GAP_MS,
  )
  return {
    hasActiveMarathonStream: hasActiveMarathonStream(registry, nowMs, {
      minStreamAgeMs: MTDO_MARATHON_STREAM_MIN_AGE_MS,
      maxLastActivityGapMs: MTDO_ACTIVE_STREAM_MAX_GAP_MS,
    }),
    quiesceActive: quiesceSnapshot.active,
  }
}

/** Track dial-timeout intent in memory only — never rewrite provider yaml or reload mihomo. */
export async function syncMarathonDialToleranceIfNeeded(
  cursorConnectionCount: number,
): Promise<boolean> {
  const targetDialTimeoutSec = resolveMarathonDialTimeoutSec(cursorConnectionCount)
  const { hasActiveMarathonStream, quiesceActive } =
    await resolveMarathonDialToleranceIdleContext(cursorConnectionCount)
  const defer = shouldDeferMarathonDialToleranceApply(
    cursorConnectionCount,
    hasActiveMarathonStream,
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
          ` target_timeout=${pendingDialTimeoutSec}s active_stream=${hasActiveMarathonStream ? 1 : 0}` +
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
