// [INPUT] marathonDialToleranceCore · marathonQuiesce state
// [OUTPUT] shouldDeferMarathonDialToleranceApply · resolveMarathonDialToleranceApplySec
// [POS] P20b SSOT: defer provider YAML reload while marathon stream or quiesce is active.

import { shouldEnableMarathonDialTolerance } from './marathonDialToleranceCore'

export interface MarathonDialToleranceIdleApplyContext {
  cursorConnectionCount: number
  hasActiveMarathonStream: boolean
  quiesceActive: boolean
  targetDialTimeoutSec: number
  lastAppliedDialTimeoutSec: number | undefined
  pendingDialTimeoutSec: number | undefined
}

export function shouldDeferMarathonDialToleranceApply(
  cursorConnectionCount: number,
  hasActiveMarathonStream: boolean,
  quiesceActive: boolean,
): boolean {
  return (
    shouldEnableMarathonDialTolerance(cursorConnectionCount) ||
    hasActiveMarathonStream ||
    quiesceActive
  )
}

export function shouldApplyMarathonDialToleranceNow(
  context: MarathonDialToleranceIdleApplyContext,
): boolean {
  const applySec = resolveMarathonDialToleranceApplySec(context)
  if (context.lastAppliedDialTimeoutSec === applySec && context.pendingDialTimeoutSec == null) {
    return false
  }
  return !shouldDeferMarathonDialToleranceApply(
    context.cursorConnectionCount,
    context.hasActiveMarathonStream,
    context.quiesceActive,
  )
}

export function resolveMarathonDialToleranceApplySec(
  context: MarathonDialToleranceIdleApplyContext,
): number {
  return context.pendingDialTimeoutSec ?? context.targetDialTimeoutSec
}

export function resolveMarathonDialTolerancePendingTarget(
  targetDialTimeoutSec: number,
  defer: boolean,
  previousPending: number | undefined,
): number | undefined {
  if (!defer) {
    return undefined
  }
  if (previousPending === targetDialTimeoutSec) {
    return previousPending
  }
  return targetDialTimeoutSec
}
