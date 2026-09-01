// [INPUT] cursorDedicatedDefault suboptimal + protocol upgrade SSOT
// [OUTPUT] evaluateMarathonProtocolColdStartGate · evaluateMarathonProtocolSwitchDecision
// [POS] R-30/R-31 SSOT — cold-start TLS gate · operator manual switch exempt.

import {
  isCursorProtocolUpgrade,
  isCursorSuboptimalNode,
} from './cursorDedicatedDefault'
import {
  isDeniedMarathonProtocolUpgradeToTls,
  MARATHON_CURSOR_OPTIMAL_VPS_NODE,
  shouldRecoverTlsLeafToHy2,
} from './marathonHy2OnlyCore'
import {
  evaluateTransportMutationAllowed,
  type TransportMutationAllowReason,
  type TransportMutationSnapshot,
} from './transportMutationGateCore'

function mapTransportMutationDenyToSwitchBlockReason(
  reason: TransportMutationAllowReason,
): MarathonProtocolSwitchBlockReason | undefined {
  switch (reason) {
    case 'deny_quarantine_active':
      return 'blocked_mtic_quarantine'
    case 'deny_hy2_parent_chain_alive':
      return 'blocked_mtic_hy2_chain_alive'
    case 'deny_stale_rids_present':
      return 'blocked_mtic_stale_rids'
    case 'deny_cursor_conn_active':
      return 'blocked_mid_session'
    case 'deny_marathon_truth_active':
      return 'blocked_marathon_active'
    default:
      return undefined
  }
}

export const MARATHON_PROTOCOL_COLD_START_GATE_COOLDOWN_MS = 300_000

export type MarathonProtocolSwitchBlockReason =
  | 'protocol_upgrade_to_tls'
  | 'allowed_trusted_idle'
  | 'allowed_manual_suboptimal_idle'
  | 'allowed_manual_operator'
  | 'blocked_marathon_active'
  | 'blocked_mid_session'
  | 'blocked_auto_suboptimal'
  | 'blocked_suboptimal_lateral'
  | 'blocked_mtic_quarantine'
  | 'blocked_mtic_hy2_chain_alive'
  | 'blocked_mtic_stale_rids'
  | 'blocked_marathon_hy2_only_tls_denied'
  | 'protocol_downgrade_from_tls'

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

/** R-40b: conn=0 cold start auto TLS — cursor_conn alone is SSOT, not stale marathonTruth. */
export function resolveShouldAutoUpgradeSuboptimalIdleTls(input: {
  cursorConnectionCount: number
  activeNode: string
}): boolean {
  // Sparkle 1.30.1: never auto HY2→TLS; marathon SSOT is HY2-only.
  void input
  return false
}

function denyTlsUpgradeIfMarathonHy2Only(
  fromNode: string,
  toNode: string,
): MarathonProtocolSwitchDecision | undefined {
  if (isDeniedMarathonProtocolUpgradeToTls(fromNode, toNode)) {
    return { allowed: false, reason: 'blocked_marathon_hy2_only_tls_denied' }
  }
  return undefined
}

export function evaluateMarathonProtocolColdStartGate(input: {
  cursorConnectionCount: number
  marathonTruthActive: boolean
  activeNode: string
  recommendedNode?: string
  /** R-31: skip gate when operator explicitly hand-picked this suboptimal leaf. */
  manualSelectionNode?: string
}): MarathonProtocolColdStartGateResult {
  const activeNode = input.activeNode.trim()
  const recommendedNode = input.recommendedNode ?? MARATHON_CURSOR_OPTIMAL_VPS_NODE
  const manualSelection = input.manualSelectionNode?.trim() ?? ''
  if (shouldRecoverTlsLeafToHy2(activeNode)) {
    return {
      required: true,
      activeNode,
      recommendedNode: MARATHON_CURSOR_OPTIMAL_VPS_NODE,
      riskClass: 'suboptimal_leaf',
    }
  }
  if (
    manualSelection &&
    manualSelection === activeNode &&
    isCursorSuboptimalNode(activeNode)
  ) {
    return {
      required: false,
      activeNode,
      recommendedNode,
      riskClass: 'none',
    }
  }
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
  // HY2 is marathon-optimal — do not cold-start gate toward TLS.
  if (activeNode === MARATHON_CURSOR_OPTIMAL_VPS_NODE) {
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
  source: 'auto' | 'manual' | 'bootstrap' | 'protocol_contract' | 'recovery_coordinator'
  mutationSnapshot?: TransportMutationSnapshot
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

  if (input.source === 'recovery_coordinator') {
    if (isCursorProtocolUpgrade(fromNode, toNode)) {
      return { allowed: true, reason: 'recovery_failover_protocol_upgrade' }
    }
    if (isCursorSuboptimalNode(fromNode) && fromNode !== toNode) {
      return { allowed: true, reason: 'recovery_failover_lateral_escape' }
    }
    if (!isCursorSuboptimalNode(toNode)) {
      return { allowed: true, reason: 'recovery_failover_trusted_target' }
    }
  }

  if (input.source === 'protocol_contract') {
    if (isCursorProtocolUpgrade(fromNode, toNode)) {
      const hy2OnlyDeny = denyTlsUpgradeIfMarathonHy2Only(fromNode, toNode)
      if (hy2OnlyDeny) {
        return hy2OnlyDeny
      }
      const snapshot: TransportMutationSnapshot = input.mutationSnapshot ?? {
        cursorConnectionCount: input.cursorConnectionCount,
        marathonTruthActive: input.marathonTruthActive,
        hy2ParentChainAgeMs: 0,
        staleRidCount: 0,
        postCoreRestartQuarantineRemainingMs: 0,
      }
      const mtic = evaluateTransportMutationAllowed('protocol_upgrade', snapshot)
      if (!mtic.allowed) {
        const mapped = mapTransportMutationDenyToSwitchBlockReason(mtic.reason)
        if (mapped) {
          return { allowed: false, reason: mapped }
        }
        return { allowed: false, reason: 'blocked_mid_session' }
      }
      return { allowed: true, reason: 'protocol_upgrade_to_tls' }
    }
  }

  // R-31: operator manual switches bypass mid-session / marathon locks (UI warns disconnect).
  if (input.source === 'manual') {
    if (
      isCursorSuboptimalNode(fromNode) &&
      isCursorSuboptimalNode(toNode) &&
      toNode !== MARATHON_CURSOR_OPTIMAL_VPS_NODE
    ) {
      return { allowed: false, reason: 'blocked_suboptimal_lateral' }
    }
    if (isCursorProtocolUpgrade(fromNode, toNode)) {
      const hy2OnlyDeny = denyTlsUpgradeIfMarathonHy2Only(fromNode, toNode)
      if (hy2OnlyDeny) {
        return hy2OnlyDeny
      }
      return { allowed: true, reason: 'protocol_upgrade_to_tls' }
    }
    if (!isCursorSuboptimalNode(toNode)) {
      return { allowed: true, reason: 'allowed_trusted_idle' }
    }
    if (input.cursorConnectionCount === 0 && !input.marathonTruthActive) {
      return { allowed: true, reason: 'allowed_manual_suboptimal_idle' }
    }
    return { allowed: true, reason: 'allowed_manual_operator' }
  }

  if (input.marathonTruthActive) {
    return { allowed: false, reason: 'blocked_marathon_active' }
  }

  if (input.cursorConnectionCount > 0) {
    return { allowed: false, reason: 'blocked_mid_session' }
  }

  if (isCursorProtocolUpgrade(fromNode, toNode)) {
    const hy2OnlyDeny = denyTlsUpgradeIfMarathonHy2Only(fromNode, toNode)
    if (hy2OnlyDeny) {
      return hy2OnlyDeny
    }
    return { allowed: true, reason: 'protocol_upgrade_to_tls' }
  }

  if (
    shouldRecoverTlsLeafToHy2(fromNode) &&
    toNode === MARATHON_CURSOR_OPTIMAL_VPS_NODE &&
    (input.source === 'auto' || input.source === 'bootstrap' || input.source === 'protocol_contract')
  ) {
    return { allowed: true, reason: 'protocol_downgrade_from_tls' }
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
