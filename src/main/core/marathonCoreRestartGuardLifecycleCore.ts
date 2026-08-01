// [INPUT] stream lifecycle journal events
// [OUTPUT] countRecentActiveLifecycleStreams
// [POS] P10-1 — core cold-restart guard reads lifecycle SSOT instead of segment tail guess.

import {
  reduceStreamLifecycleEvents,
  type StreamLifecycleEvent,
} from './streamLifecycleTruthCore'

export const MARATHON_CORE_RESTART_LIFECYCLE_LOOKBACK_MS = 30 * 60 * 1000

export function countRecentActiveLifecycleStreams(input: {
  events: readonly StreamLifecycleEvent[]
  nowMs: number
  lookbackMs?: number
}): number {
  const lookbackMs = input.lookbackMs ?? MARATHON_CORE_RESTART_LIFECYCLE_LOOKBACK_MS
  const sinceMs = input.nowMs - lookbackMs
  const lifecycleState = reduceStreamLifecycleEvents(input.events)
  let count = 0
  for (const generation of lifecycleState.values()) {
    if (generation.phase !== 'active') {
      continue
    }
    const anchorMs = generation.lastActivityAtMs ?? 0
    if (anchorMs < sinceMs) {
      continue
    }
    count += 1
  }
  return count
}
