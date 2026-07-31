// [INPUT] marathonSegmentCache records
// [OUTPUT] countRecentMarathonUserMessageSegments
// [POS] P10b — block core cold restart while recent userMessage segments exist.

import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'

export const MARATHON_CORE_RESTART_USER_MESSAGE_LOOKBACK_MS = 30 * 60 * 1000

export function countRecentMarathonUserMessageSegments(input: {
  records: readonly MarathonSegmentCacheRecord[]
  nowMs: number
  lookbackMs?: number
}): number {
  const lookbackMs = input.lookbackMs ?? MARATHON_CORE_RESTART_USER_MESSAGE_LOOKBACK_MS
  const sinceMs = input.nowMs - lookbackMs
  let count = 0
  for (const record of input.records) {
    if (record.httpStartMs < sinceMs) {
      continue
    }
    if (record.actionCase !== 'userMessageAction') {
      continue
    }
    count += 1
  }
  return count
}
