// [INPUT] quiesce · marathon truth · longevity json · token gap · core ready timestamp
// [OUTPUT] resolveTransportMutationSnapshot
// [POS] MTIC-v2 runtime — assemble snapshot for evaluateTransportMutationAllowed.

import {
  remainingPostCoreRestartQuarantineMs,
} from './coreRestartQuarantineCore'
import { safeGetLastCoreReadyAtMs } from './coreReadyTimestamp'
import type { TransportMutationSnapshot } from './transportMutationGateCore'
import { resolveHy2ParentChainAgeMs } from './transportMutationGateCore'

export async function resolveTransportMutationSnapshot(input: {
  cursorConnectionCount: number
  marathonTruthActive: boolean
  nowMs?: number
}): Promise<TransportMutationSnapshot> {
  const nowMs = input.nowMs ?? Date.now()
  const coreReadyAtMs = safeGetLastCoreReadyAtMs()
  const quarantineRemainingMs = remainingPostCoreRestartQuarantineMs(coreReadyAtMs, nowMs)

  let hy2ParentChainAgeMs = 0
  try {
    const { readTransportLongevityTruthSnapshot } = await import('./transportLongevityTruth')
    const longevity = await readTransportLongevityTruthSnapshot()
    if (longevity) {
      hy2ParentChainAgeMs = resolveHy2ParentChainAgeMs({
        nowMs,
        hy2ParentChainBirthMs: longevity.hy2ParentChainBirthMs,
        httpParentChainAgeMs: longevity.httpParentChainAgeMs,
        outboundHy2SessionAgeMs: longevity.outboundHy2SessionAgeMs,
      })
    }
  } catch {
    hy2ParentChainAgeMs = 0
  }

  let staleRidCount = 0
  try {
    const { getMarathonTokenGapSnapshotForMutationGate } = await import('./mihomoQuicSilentStallRecovery')
    const tokenGap = getMarathonTokenGapSnapshotForMutationGate()
    staleRidCount = Math.max(0, tokenGap.staleRequestIdCount)
  } catch {
    staleRidCount = 0
  }

  return {
    cursorConnectionCount: Math.max(0, input.cursorConnectionCount),
    marathonTruthActive: input.marathonTruthActive,
    hy2ParentChainAgeMs,
    staleRidCount,
    postCoreRestartQuarantineRemainingMs: quarantineRemainingMs,
  }
}
