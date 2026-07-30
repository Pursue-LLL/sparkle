// [INPUT] MihomoDelayPurpose
// [OUTPUT] shouldBlockMarathonProviderMutation · formatMarathonProviderMutationBlockedLogLine
// [POS] R-22 SSOT — block provider yaml reload during marathon; rescue dial uses cache only.

import type { MihomoDelayPurpose } from './mihomoProxyDelayCore'
import { isUserExplicitDelayPurpose } from './mihomoProxyDelayCore'

export function shouldBlockMarathonProviderMutation(input: {
  marathonTruthActive: boolean
  purpose: MihomoDelayPurpose | undefined
}): boolean {
  if (!input.marathonTruthActive) {
    return false
  }
  return !isUserExplicitDelayPurpose(input.purpose)
}

export function formatMarathonProviderMutationBlockedLogLine(input: {
  operation: 'provider_update' | 'provider_reload'
  providerName: string
  purpose: MihomoDelayPurpose | undefined
  cursorConnectionCount: number
}): string {
  return (
    `[MarathonDataPlaneGuard]: blocked_${input.operation}` +
    ` provider=${input.providerName}` +
    ` purpose=${input.purpose ?? 'default'}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    ` marathon_truth_active=1 data_plane_action=none\n`
  )
}
