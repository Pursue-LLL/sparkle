// [INPUT] marathonDataPlaneMutationGuardCore · marathonSSETruthRuntime · marathonQuiesce
// [OUTPUT] evaluateMarathonProviderMutationBlock
// [POS] R-22 runtime — async marathon_truth_active gate for provider mutation.

import type { MihomoDelayPurpose } from './mihomoProxyDelayCore'
import { shouldBlockMarathonProviderMutation } from './marathonDataPlaneMutationGuardCore'

export interface MarathonProviderMutationBlockResult {
  blocked: boolean
  marathonTruthActive: boolean
  cursorConnectionCount: number
}

export async function evaluateMarathonProviderMutationBlock(
  purpose: MihomoDelayPurpose | undefined,
): Promise<MarathonProviderMutationBlockResult> {
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const cursorConnectionCount = quiesceSnapshot.cursorConnectionCount
  const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  const blocked = shouldBlockMarathonProviderMutation({
    marathonTruthActive: truth.marathonTruthActive,
    purpose,
  })
  return {
    blocked,
    marathonTruthActive: truth.marathonTruthActive,
    cursorConnectionCount,
  }
}
