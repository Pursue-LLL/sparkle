// [INPUT] cursorDedicatedDefault suboptimal + protocol upgrade SSOT
// [OUTPUT] evaluateMarathonProtocolColdStartGate · evaluateMarathonProtocolSwitchDecision
// [POS] R-30 SSOT — cold-start TLS gate · zero mid-marathon leaf mutation.

import {
  CURSOR_DEFAULT_VPS_NODE,
  isCursorProtocolUpgrade,
  isCursorSuboptimalNode,
} from './cursorDedicatedDefault'

export const MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS = 300_000

export type MarathonProtocolSwitchBlockReason =
  | 'protocol_upgrade_to_tls'
  | 'allowed_trusted_idle'
  | 'allowed_manual_suboptimal_idle'
  | 'blocked_marathon_active'
  | 'blocked_mid_session'
  | 'blocked_auto_suboptimal'
  | 'blocked_suboptimal_lateral'
  | 'noop'

export interface MarathonProtocolColdStartGateResult {
  required: boolean
  activeNode: string
  recommendedNode: string
  riskClass: 'suboptimal_leaf' | 'none'
}

export interface MarathonProtocolSwitchDecision {
  allowed: boolean
  reason: MarathonProtocolSwitchBlockReason
}

export function evaluateMarathonProtocolColdStartGate(input: {
  cursorConnectionCount: number
  marathonTruthActive: boolean
  activeNode: string
  recommendedNode?: string
}): MarathonProtocolColdStartGateResult {
  const activeNode = input.activeNode.trim()
  const recommendedNode = input.recommendedNode ?? CURSOR_DEFAULT_VPS_NODE
  if (
    input.cursorConnectionCount !== 0 ||
    input.marathonTruthActive ||
    !activeNode ||
    !isCursorSuboptimalNode(activeNode)
  ) {
    return {
      required: false,
      activeNode,
      recommendedNode,
      riskClass: 'none',
    }
  }
  return {
    required: true,
    activeNode,
    recommendedNode,
    riskClass: 'suboptimal_leaf',
  }
}

export function evaluateMarathonProtocolSwitchDecision(input: {
  cursorConnectionCount: number
  marathonTruthActive: boolean
  fromNode: string
  toNode: string
  source: 'auto' | 'manual' | 'bootstrap' | 'protocol_contract'
}): MarathonProtocolSwitchDecision {
  const fromNode = input.fromNode.trim()
  const toNode = input.toNode.trim()
  if (!toNode) {
    return { allowed: false, reason: 'noop' }
  }
  if (!fromNode) {
    if (input.source === 'auto' || input.source === 'bootstrap') {
      if (isCursorSuboptimalNode(toNode)) {
        return { allowed: false, reason: 'blocked_auto_suboptimal' }
      }
      return { allowed: true, reason: 'allowed_trusted_idle' }
    }
    return { allowed: true, reason: 'allowed_manual_suboptimal_idle' }
  }
  if (fromNode === toNode) {
    return { allowed: false, reason: 'noop' }
  }

  if (input.source === 'protocol_contract') {
    if (
      input.cursorConnectionCount === 0 &&
      !input.marathonTruthActive &&
      isCursorProtocolUpgrade(fromNode, toNode)
    ) {
      return { allowed: true, reason: 'protocol_upgrade_to_tls' }
    }
  }

  if (input.marathonTruthActive) {
    return { allowed: false, reason: 'blocked_marathon_active' }
  }

  if (input.cursorConnectionCount > 0) {
    return { allowed: false, reason: 'blocked_mid_session' }
  }

  if (isCursorProtocolUpgrade(fromNode, toNode)) {
    return { allowed: true, reason: 'protocol_upgrade_to_tls' }
  }

  if (!isCursorSuboptimalNode(toNode)) {
    return { allowed: true, reason: 'allowed_trusted_idle' }
  }

  if (input.source === 'auto' || input.source === 'bootstrap') {
    return { allowed: false, reason: 'blocked_auto_suboptimal' }
  }

  if (isCursorSuboptimalNode(fromNode) && isCursorSuboptimalNode(toNode)) {
    return { allowed: false, reason: 'blocked_suboptimal_lateral' }
  }

  return { allowed: true, reason: 'allowed_manual_suboptimal_idle' }
}

export function formatMarathonProtocolColdStartGateLogLine(
  gate: MarathonProtocolColdStartGateResult,
): string {
  return (
    `[MarathonProtocolContract]: outcome=gate_required` +
    ` risk=${gate.riskClass}` +
    ` node=${gate.activeNode}` +
    ` recommended=${gate.recommendedNode}` +
    ` cursor_conn=0\n`
  )
}

export function formatMarathonProtocolSwitchBlockedLogLine(input: {
  group: string
  fromNode: string
  toNode: string
  reason: MarathonProtocolSwitchBlockReason
  cursorConnectionCount: number
  marathonTruthActive: boolean
  source: string
}): string {
  return (
    `[MarathonProtocolContract]: outcome=switch_blocked` +
    ` group=${input.group}` +
    ` from=${input.fromNode}` +
    ` to=${input.toNode}` +
    ` reason=${input.reason}` +
    ` source=${input.source}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    ` marathon_truth_active=${input.marathonTruthActive ? 1 : 0}\n`
  )
}

export function formatMarathonProtocolUpgradeLogLine(input: {
  group: string
  fromNode: string
  toNode: string
  source: string
}): string {
  return (
    `[MarathonProtocolContract]: outcome=protocol_upgrade` +
    ` group=${input.group}` +
    ` from=${input.fromNode}` +
    ` to=${input.toNode}` +
    ` source=${input.source}\n`
  )
}

export function formatMarathonProtocolLateStartLogLine(input: {
  activeNode: string
  cursorConnectionCount: number
}): string {
  return (
    `[MarathonProtocolContract]: outcome=marathon_started_on_suboptimal_leaf` +
    ` node=${input.activeNode}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    ` gate_missed=1\n`
  )
}
