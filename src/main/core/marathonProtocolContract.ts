// [INPUT] marathonProtocolContractCore · mihomoApi · marathonSSETruthRuntime · marathonQuiesce
// [OUTPUT] runMarathonProtocolColdStartGateIfDue · evaluateMarathonProtocolSwitchBlock
// [POS] R-30 runtime — cold-start gate dialog + mihomoChangeProxy enforcement.

import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { mihomoChangeProxy } from './mihomoApi'
import {
  evaluateMarathonProtocolColdStartGate,
  formatMarathonProtocolColdStartGateLogLine,
  formatMarathonProtocolLateStartLogLine,
  formatMarathonProtocolSwitchBlockedLogLine,
  MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS,
  resolveShouldAutoUpgradeSuboptimalIdleTls,
  type MarathonProtocolSwitchBlockReason,
} from './marathonProtocolContractCore'
import { evaluateMarathonProtocolSwitchDecision } from './marathonProtocolContractCore'

let lastColdStartGatePromptAtMs = 0
let coldStartGatePromptCount = 0

export function resetMarathonProtocolContractForTests(): void {
  lastColdStartGatePromptAtMs = 0
  coldStartGatePromptCount = 0
}

export interface MarathonProtocolSwitchBlockResult {
  blocked: boolean
  reason: MarathonProtocolSwitchBlockReason
  cursorConnectionCount: number
  marathonTruthActive: boolean
}

export async function evaluateMarathonProtocolSwitchBlock(input: {
  group: string
  fromNode: string
  toNode: string
  source: 'auto' | 'manual' | 'bootstrap' | 'protocol_contract' | 'recovery_coordinator'
}): Promise<MarathonProtocolSwitchBlockResult> {
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const cursorConnectionCount = quiesceSnapshot.cursorConnectionCount
  const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  const { resolveTransportMutationSnapshot } = await import('./transportMutationGateRuntime')
  const mutationSnapshot = await resolveTransportMutationSnapshot({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
  })
  const decision = evaluateMarathonProtocolSwitchDecision({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
    fromNode: input.fromNode,
    toNode: input.toNode,
    source: input.source,
    mutationSnapshot,
  })
  if (!decision.allowed && input.source === 'protocol_contract') {
    const { formatTransportMutationGateLogLine } = await import('./transportMutationGateCore')
    const { appendAppLog } = await import('../utils/log')
    await appendAppLog(
      formatTransportMutationGateLogLine({
        mutation: 'protocol_upgrade',
        decision: {
          allowed: false,
          reason:
            decision.reason === 'blocked_mtic_quarantine'
              ? 'deny_quarantine_active'
              : decision.reason === 'blocked_mtic_hy2_chain_alive'
                ? 'deny_hy2_parent_chain_alive'
                : decision.reason === 'blocked_mtic_stale_rids'
                  ? 'deny_stale_rids_present'
                  : decision.reason === 'blocked_mid_session'
                    ? 'deny_cursor_conn_active'
                    : decision.reason === 'blocked_marathon_active'
                      ? 'deny_marathon_truth_active'
                      : 'deny_unknown_mutation',
        },
        cursorConnectionCount,
        hy2ParentChainAgeMs: mutationSnapshot.hy2ParentChainAgeMs,
        staleRidCount: mutationSnapshot.staleRidCount,
        quarantineRemainingMs: mutationSnapshot.postCoreRestartQuarantineRemainingMs,
      }),
    )
  }
  return {
    blocked: !decision.allowed,
    reason: decision.reason,
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
  }
}

export async function executeMarathonProtocolColdStartUpgrade(
  activeNode: string,
  recommendedNode: string,
): Promise<boolean> {
  return mihomoChangeProxy(CURSOR_DEDICATED_GROUP_NAME, recommendedNode, {
    source: 'protocol_contract',
  })
}

export async function runMarathonProtocolColdStartGateIfDue(
  activeNode: string,
  cursorConnectionCount: number,
): Promise<void> {
  const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  const { readCursorDedicatedManualSelection } = await import('./cursorDedicatedSelectionCore')
  const manualSelectionNode = await readCursorDedicatedManualSelection()
  const gate = evaluateMarathonProtocolColdStartGate({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
    activeNode,
    manualSelectionNode,
  })

  const { isCursorSuboptimalNode } = await import('./cursorDedicatedDefault')
  const {
    MARATHON_CURSOR_OPTIMAL_VPS_NODE,
    isMarathonTlsCanaryLeaf,
    formatMarathonHy2OnlyTlsDeniedLogLine,
    formatMarathonHy2OnlyDowngradeLogLine,
  } = await import('./marathonHy2OnlyCore')
  const trimmedActive = activeNode.trim()
  const shouldAutoUpgradeTls = resolveShouldAutoUpgradeSuboptimalIdleTls({
    cursorConnectionCount,
    activeNode: trimmedActive,
  })

  if (!gate.required && !shouldAutoUpgradeTls) {
    if (
      manualSelectionNode &&
      manualSelectionNode.trim() === trimmedActive &&
      isCursorSuboptimalNode(trimmedActive)
    ) {
      const { appendAppLog } = await import('../utils/log')
      await appendAppLog(
        `[MarathonProtocolContract]: outcome=gate_skipped_manual_selection` +
          ` node=${trimmedActive}` +
          ` cursor_conn=${cursorConnectionCount}\n`,
      )
    }
    return
  }

  const nowMs = Date.now()
  if (
    !shouldAutoUpgradeTls &&
    coldStartGatePromptCount > 0 &&
    nowMs - lastColdStartGatePromptAtMs < MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS
  ) {
    return
  }
  coldStartGatePromptCount += 1
  lastColdStartGatePromptAtMs = nowMs

  const recommendedNode = gate.required ? gate.recommendedNode : MARATHON_CURSOR_OPTIMAL_VPS_NODE
  const { appendAppLog } = await import('../utils/log')
  if (gate.required) {
    await appendAppLog(formatMarathonProtocolColdStartGateLogLine(gate))
  } else if (shouldAutoUpgradeTls) {
    await appendAppLog(
      `[MarathonProtocolContract]: outcome=auto_upgrade_suboptimal_idle` +
        ` node=${trimmedActive} recommended=${recommendedNode} cursor_conn=${cursorConnectionCount}` +
        ` marathon_truth_active=${truth.marathonTruthActive ? 1 : 0}\n`,
    )
  }

  const { resolveTransportMutationSnapshot } = await import('./transportMutationGateRuntime')
  const { evaluateTransportMutationAllowed, formatTransportMutationGateLogLine } = await import(
    './transportMutationGateCore'
  )
  const mutationSnapshot = await resolveTransportMutationSnapshot({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
  })

  const switchDecision = evaluateMarathonProtocolSwitchDecision({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
    fromNode: trimmedActive,
    toNode: recommendedNode,
    source: 'protocol_contract',
    mutationSnapshot,
  })
  if (!switchDecision.allowed) {
    if (switchDecision.reason === 'blocked_marathon_hy2_only_tls_denied') {
      await appendAppLog(
        formatMarathonHy2OnlyTlsDeniedLogLine({
          fromNode: trimmedActive,
          toNode: recommendedNode,
          source: 'protocol_contract',
        }),
      )
    }
    await appendAppLog(
      `[MarathonProtocolContract]: outcome=protocol_switch_blocked` +
        ` from=${trimmedActive} to=${recommendedNode} reason=${switchDecision.reason}\n`,
    )
    return
  }

  const mutationKind = isMarathonTlsCanaryLeaf(trimmedActive) ? 'node_switch' : 'protocol_upgrade'
  const mtic = evaluateTransportMutationAllowed(mutationKind, {
    ...mutationSnapshot,
    marathonHy2RecoverTlsToHy2: isMarathonTlsCanaryLeaf(trimmedActive),
  })
  if (!mtic.allowed) {
    await appendAppLog(
      formatTransportMutationGateLogLine({
        mutation: mutationKind,
        decision: mtic,
        cursorConnectionCount,
        hy2ParentChainAgeMs: mutationSnapshot.hy2ParentChainAgeMs,
        staleRidCount: mutationSnapshot.staleRidCount,
        quarantineRemainingMs: mutationSnapshot.postCoreRestartQuarantineRemainingMs,
      }),
    )
    await appendAppLog(
      `[MarathonProtocolContract]: outcome=protocol_switch_blocked` +
        ` from=${trimmedActive} to=${recommendedNode} reason=${mtic.reason}\n`,
    )
    return
  }

  const switched = await executeMarathonProtocolColdStartUpgrade(trimmedActive, recommendedNode)
  if (isMarathonTlsCanaryLeaf(trimmedActive)) {
    await appendAppLog(
      formatMarathonHy2OnlyDowngradeLogLine({
        fromNode: trimmedActive,
        toNode: recommendedNode,
        cursorConnectionCount,
        executed: switched,
      }),
    )
    return
  }
  await appendAppLog(
    `[MarathonProtocolContract]: outcome=${switched ? 'protocol_upgrade_executed' : 'protocol_upgrade_failed'}` +
      ` from=${trimmedActive} to=${recommendedNode} cursor_conn=${cursorConnectionCount}\n`,
  )
}

export async function notifyMarathonStartedOnSuboptimalLeafIfNeeded(
  cursorConnectionCount: number,
  activeNode: string,
): Promise<void> {
  const trimmed = activeNode.trim()
  if (!trimmed || cursorConnectionCount <= 0) {
    return
  }
  const { isCursorSuboptimalNode } = await import('./cursorDedicatedDefault')
  if (!isCursorSuboptimalNode(trimmed)) {
    return
  }
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatMarathonProtocolLateStartLogLine({
      activeNode: trimmed,
      cursorConnectionCount,
    }),
  )
  const { appendNetworkStabilityEvent } = await import('./networkStabilityMonitor')
  await appendNetworkStabilityEvent({
    ts: new Date().toISOString(),
    kind: 'transport_recovery',
    probe_ok: true,
    recovery_action: 'none',
    hung_connection_count: cursorConnectionCount,
    error_detail: `marathon_started_on_suboptimal_leaf node=${trimmed}`,
  })
}

export async function logMarathonProtocolSwitchBlocked(input: {
  group: string
  fromNode: string
  toNode: string
  source: string
  block: MarathonProtocolSwitchBlockResult
}): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(
    formatMarathonProtocolSwitchBlockedLogLine({
      group: input.group,
      fromNode: input.fromNode,
      toNode: input.toNode,
      reason: input.block.reason,
      cursorConnectionCount: input.block.cursorConnectionCount,
      marathonTruthActive: input.block.marathonTruthActive,
      source: input.source,
    }),
  )
}
