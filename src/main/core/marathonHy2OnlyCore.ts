// [INPUT] cursorDedicatedDefault protocol upgrade helpers
// [OUTPUT] marathon HY2-only SSOT — deny auto/protocol_contract upgrade to TLS canary
// [POS] Sparkle 1.30.1 — fixes 2026-08-04 protocol_upgrade_executed HY2→TLS waste.

import { isCursorProtocolUpgrade } from './cursorDedicatedDefault'

export const MARATHON_CURSOR_OPTIMAL_VPS_NODE = 'KR-VPS-Reality' as const

const MARATHON_TLS_LEAF_RE = /-VPS-TLS$/i

export function isMarathonTlsCanaryLeaf(node: string): boolean {
  return MARATHON_TLS_LEAF_RE.test(node.trim())
}

/** Auto / protocol_contract must never promote marathon traffic onto TLS canary (:18443). */
export function isDeniedMarathonProtocolUpgradeToTls(fromNode: string, toNode: string): boolean {
  return isCursorProtocolUpgrade(fromNode, toNode) && isMarathonTlsCanaryLeaf(toNode)
}

export function shouldRecoverTlsLeafToHy2(activeNode: string): boolean {
  return isMarathonTlsCanaryLeaf(activeNode)
}

/** Marathon Cursor 专用组禁止出现的 VPS leaf（历史 TLS canary :18443）。 */
export function isMarathonExcludedCursorVpsLeaf(node: string): boolean {
  return isMarathonTlsCanaryLeaf(node)
}

export function filterMarathonCursorEligibleVpsLeaves(leaves: readonly string[]): string[] {
  return leaves.filter((name) => !isMarathonExcludedCursorVpsLeaf(name))
}

/** Provider-mode Cursor 专用 filter — Reality first, HY2 secondary. */
export const MARATHON_CURSOR_VPS_PROVIDER_FILTER = '(?i)-VPS-(Reality|HY2)$'

export function formatMarathonHy2OnlyTlsDeniedLogLine(input: {
  fromNode: string
  toNode: string
  source: string
}): string {
  return (
    `[MarathonHy2Only]: outcome=tls_leaf_denied` +
    ` from=${input.fromNode}` +
    ` to=${input.toNode}` +
    ` source=${input.source}` +
    ` reason=marathon_hy2_only\n`
  )
}

export function formatMarathonHy2OnlyDowngradeLogLine(input: {
  fromNode: string
  toNode: string
  cursorConnectionCount: number
  executed: boolean
}): string {
  return (
    `[MarathonHy2Only]: outcome=${input.executed ? 'protocol_downgrade_executed' : 'protocol_downgrade_failed'}` +
    ` from=${input.fromNode}` +
    ` to=${input.toNode}` +
    ` cursor_conn=${input.cursorConnectionCount}` +
    ` reason=marathon_hy2_only\n`
  )
}

export function formatMarathonHy2OnlySsotBootLogLine(input: {
  activeNode: string
}): string {
  return (
    `[MarathonHy2Only]: outcome=ssot_boot` +
    ` active=${input.activeNode}` +
    ` optimal=${MARATHON_CURSOR_OPTIMAL_VPS_NODE}` +
    ` deny_tls_upgrade=1\n`
  )
}
