// [INPUT] caller · block reason · monotonic now
// [OUTPUT] throttle duplicate core_cold_restart_blocked app logs
// [POS] Phase 1S log hygiene — blocked≠failure, suppress 5min spam

const BLOCKED_LOG_MIN_INTERVAL_MS = 300_000

const lastEmittedAtByKey = new Map<string, number>()
const suppressedCountByKey = new Map<string, number>()

function throttleKey(caller: string, reason: string): string {
  return `${caller}|${reason}`
}

export function resetCoreLifecycleBlockedLogThrottleForTests(): void {
  lastEmittedAtByKey.clear()
  suppressedCountByKey.clear()
}

export function planCoreLifecycleBlockedLog(input: {
  caller: string
  reason: string
  nowMs: number
  formattedLine: string
}): { emit: boolean; line: string } {
  const key = throttleKey(input.caller, input.reason)
  const lastMs = lastEmittedAtByKey.get(key)
  if (lastMs !== undefined && input.nowMs - lastMs < BLOCKED_LOG_MIN_INTERVAL_MS) {
    suppressedCountByKey.set(key, (suppressedCountByKey.get(key) ?? 0) + 1)
    return { emit: false, line: '' }
  }

  const suppressed = suppressedCountByKey.get(key) ?? 0
  suppressedCountByKey.set(key, 0)
  lastEmittedAtByKey.set(key, input.nowMs)

  if (suppressed <= 0) {
    return { emit: true, line: input.formattedLine }
  }

  const summary =
    `[CoreLifecycle]: core_cold_restart_blocked_summary caller=${input.caller} reason=${input.reason} ` +
    `suppressed_repeats=${suppressed} window_ms=${BLOCKED_LOG_MIN_INTERVAL_MS}\n`
  return { emit: true, line: `${input.formattedLine}${summary}` }
}
