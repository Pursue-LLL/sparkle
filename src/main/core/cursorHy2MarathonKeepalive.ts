// [INPUT] cursorHy2MarathonKeepaliveCore · marathonRescueDialExecutor · marathonWarmthDialExecutor
// [OUTPUT] runHy2MarathonSessionKeepaliveIfDue → MarathonSessionKeepaliveResult
// [POS] Mac HY2/TUIC session nudge facade — delegates to P19 executors (no MTDO re-entrancy guard).
import {
  isMarathonRescueTrigger,
  type MarathonSessionKeepaliveResult,
  type MarathonWarmthTrigger,
} from './cursorHy2MarathonKeepaliveCore'
export { resolveCursorDedicatedActiveNode } from './cursorDedicatedNodeResolver'
import {
  getLastHy2SessionKeepaliveAtMs,
  isHy2SessionDialInFlight,
  resetMarathonSessionDialExecutorStateForTests,
} from './marathonSessionDialExecutorCore'
import { executeMarathonRescueDial } from './marathonRescueDialExecutor'
import { executeMarathonWarmthDial } from './marathonWarmthDialExecutor'

export interface MarathonSessionKeepaliveRequest {
  trigger: MarathonWarmthTrigger
  maxGapMs?: number
  staleRequestIdCount?: number
  nowMs?: number
}

export type { MarathonSessionKeepaliveResult } from './cursorHy2MarathonKeepaliveCore'

export async function runHy2MarathonSessionKeepaliveIfDue(
  cursorConnectionCount: number,
  request?: MarathonSessionKeepaliveRequest,
): Promise<MarathonSessionKeepaliveResult> {
  const trigger = request?.trigger ?? 'periodic_session'
  const nowMs = request?.nowMs ?? Date.now()

  if (isMarathonRescueTrigger(trigger)) {
    return executeMarathonRescueDial(cursorConnectionCount, {
      trigger,
      nowMs,
      maxGapMs: request?.maxGapMs,
      staleRequestIdCount: request?.staleRequestIdCount,
    })
  }

  return executeMarathonWarmthDial(cursorConnectionCount, { trigger, nowMs })
}

export function isHy2MarathonSessionKeepaliveInFlight(): boolean {
  return isHy2SessionDialInFlight()
}

export function resetHy2MarathonSessionKeepaliveStateForTests(): void {
  resetMarathonSessionDialExecutorStateForTests()
}

export function getHy2MarathonSessionKeepaliveLastAtMsForTests(): number {
  return getLastHy2SessionKeepaliveAtMs()
}
