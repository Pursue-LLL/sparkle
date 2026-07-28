// [INPUT] coreReadyTimestamp
// [OUTPUT] isPostCoreRestartQuarantineActive · POST_CORE_RESTART_QUARANTINE_MS
// [POS] TIP-1: after mihomo/TUN cold restart, defer batch observability dials that contend with Agent traffic.

import type { ObservabilityDialKind } from './marathonQuiesceCore'

export const POST_CORE_RESTART_QUARANTINE_MS = 10 * 60 * 1000

const QUARANTINE_DEFERRED_DIAL_KINDS: ReadonlySet<ObservabilityDialKind> = new Set([
  'regional_url_test_warmup',
  'marketplace_probe',
])

export function isPostCoreRestartQuarantineActive(
  coreReadyAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(coreReadyAtMs) || coreReadyAtMs <= 0) {
    return false
  }
  return nowMs - coreReadyAtMs < POST_CORE_RESTART_QUARANTINE_MS
}

export function remainingPostCoreRestartQuarantineMs(
  coreReadyAtMs: number,
  nowMs: number = Date.now(),
): number {
  if (!isPostCoreRestartQuarantineActive(coreReadyAtMs, nowMs)) {
    return 0
  }
  return Math.max(0, POST_CORE_RESTART_QUARANTINE_MS - (nowMs - coreReadyAtMs))
}

export function shouldDeferObservabilityDialDuringPostCoreRestartQuarantine(
  kind: ObservabilityDialKind,
  coreReadyAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!isPostCoreRestartQuarantineActive(coreReadyAtMs, nowMs)) {
    return false
  }
  return QUARANTINE_DEFERRED_DIAL_KINDS.has(kind)
}
