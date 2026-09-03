// [INPUT] recoveryFailoverGovernanceCore · mihomoApi · cursorDedicatedSelectionCore
// [OUTPUT] attemptCursorDedicatedHy2FailbackIfDue
// [POS] BUG-2026-09-03-004 runtime — auto failback from TCP failover leaves to HY2 after vitality proof.

import { appendAppLog } from '../utils/log'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { resolveCursorDedicatedActiveNode } from './cursorDedicatedNodeResolver'
import { writeCursorDedicatedManualSelection } from './cursorDedicatedSelectionCore'
import { getLastHy2TunnelVitalityAtMs } from './hy2TunnelVitality'
import { shouldFailbackCursorDedicatedToHy2 } from './recoveryFailoverGovernanceCore'

let failbackInFlight = false

export function resetCursorDedicatedFailbackForTests(): void {
  failbackInFlight = false
}

export async function attemptCursorDedicatedHy2FailbackIfDue(
  preferredHy2Leaf: string,
  nowMs?: number,
): Promise<{ executed: boolean; reason: string }> {
  if (failbackInFlight) {
    return { executed: false, reason: 'failback_in_flight' }
  }
  const atMs = nowMs ?? Date.now()
  const mihomoLiveLeaf = await resolveCursorDedicatedActiveNode()
  const currentLeaf = mihomoLiveLeaf?.trim() || undefined
  const decision = shouldFailbackCursorDedicatedToHy2({
    currentLeaf,
    preferredHy2Leaf,
    lastVitalitySuccessAtMs: getLastHy2TunnelVitalityAtMs(),
    nowMs: atMs,
  })
  if (!decision.failback) {
    return { executed: false, reason: decision.reason }
  }
  failbackInFlight = true
  try {
    const { mihomoChangeProxy } = await import('./mihomoApi')
    const changed = await mihomoChangeProxy(
      CURSOR_DEDICATED_GROUP_NAME,
      decision.targetLeaf,
      { source: 'hy2_vitality_failback' },
    )
    if (changed) {
      await writeCursorDedicatedManualSelection(decision.targetLeaf)
    }
    await appendAppLog(
      `[RecoveryFailback]: outcome=${changed ? 'executed' : 'failed'} ` +
        `from=${currentLeaf ?? 'unknown'} target=${decision.targetLeaf} reason=${decision.reason}\n`,
    )
    return {
      executed: changed,
      reason: changed ? decision.reason : 'failback_change_proxy_failed',
    }
  } finally {
    failbackInFlight = false
  }
}
