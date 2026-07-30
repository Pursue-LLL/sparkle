// [INPUT] marathonProtocolContractCore · mihomoApi · marathonSSETruthRuntime · marathonQuiesce
// [OUTPUT] runMarathonProtocolColdStartGateIfDue · evaluateMarathonProtocolSwitchBlock
// [POS] R-30 runtime — cold-start gate dialog + mihomoChangeProxy enforcement.

import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  evaluateMarathonProtocolColdStartGate,
  formatMarathonProtocolColdStartGateLogLine,
  formatMarathonProtocolLateStartLogLine,
  formatMarathonProtocolSwitchBlockedLogLine,
  MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS,
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
  source: 'auto' | 'manual' | 'bootstrap' | 'protocol_contract'
}): Promise<MarathonProtocolSwitchBlockResult> {
  const { getMarathonQuiesceSnapshot } = await import('./marathonQuiesce')
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const cursorConnectionCount = quiesceSnapshot.cursorConnectionCount
  const { resolveMarathonSSETruthNow } = await import('./marathonSSETruthRuntime')
  const truth = await resolveMarathonSSETruthNow(cursorConnectionCount)
  const decision = evaluateMarathonProtocolSwitchDecision({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
    fromNode: input.fromNode,
    toNode: input.toNode,
    source: input.source,
  })
  return {
    blocked: !decision.allowed,
    reason: decision.reason,
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
  }
}

async function promptColdStartProtocolUpgrade(
  activeNode: string,
  recommendedNode: string,
): Promise<boolean> {
  const { dialog } = await import('electron')
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['一键切 TLS', '继续使用（高风险）'],
    defaultId: 0,
    cancelId: 1,
    title: 'Cursor 马拉松协议门禁',
    message: `当前节点「${activeNode}」为 QUIC/Reality 高风险协议`,
    detail:
      `马拉松长连接建议使用「${recommendedNode}」。` +
      '赛中切换会断连并浪费 Included 次数；请在冷启动（无 Agent 连接）时切换。',
  })
  return response === 0
}

export async function executeMarathonProtocolColdStartUpgrade(
  activeNode: string,
  recommendedNode: string,
): Promise<boolean> {
  const { mihomoChangeProxy } = await import('./mihomoApi')
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
  const gate = evaluateMarathonProtocolColdStartGate({
    cursorConnectionCount,
    marathonTruthActive: truth.marathonTruthActive,
    activeNode,
  })
  if (!gate.required) {
    return
  }

  const nowMs = Date.now()
  if (
    coldStartGatePromptCount > 0 &&
    nowMs - lastColdStartGatePromptAtMs < MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS
  ) {
    return
  }
  coldStartGatePromptCount += 1
  lastColdStartGatePromptAtMs = nowMs

  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(formatMarathonProtocolColdStartGateLogLine(gate))

  const accepted = await promptColdStartProtocolUpgrade(gate.activeNode, gate.recommendedNode)
  if (accepted) {
    await executeMarathonProtocolColdStartUpgrade(gate.activeNode, gate.recommendedNode)
  }
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
