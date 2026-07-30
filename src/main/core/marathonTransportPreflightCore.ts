// [INPUT] cursorHy2MarathonKeepaliveCore QUIC SSOT · cursorDedicatedDefault suboptimal markers
// [OUTPUT] resolveMarathonTransportPreflight · formatMarathonTransportPreflightLogLine
// [POS] R-19 SSOT — observe-only preflight when marathon_truth_active 0→1.

import { isMarathonQuIcInboundCursorNode } from './cursorHy2MarathonKeepaliveCore'
import { isCursorSuboptimalNode } from './cursorDedicatedDefault'

export type MarathonTransportProtocolClass = 'tcp_tls' | 'quic_inbound' | 'other'

export interface MarathonTransportPreflightResult {
  activeNode: string
  protocolClass: MarathonTransportProtocolClass
  quicLeafActive: boolean
  splitBrainRiskClass: 'none' | 'split_brain_class'
  cursorConnectionCount: number
}

export function resolveMarathonTransportProtocolClass(nodeName: string): MarathonTransportProtocolClass {
  const normalized = nodeName.trim()
  if (!normalized) {
    return 'other'
  }
  if (/-TLS$/i.test(normalized)) {
    return 'tcp_tls'
  }
  if (isMarathonQuIcInboundCursorNode(normalized)) {
    return 'quic_inbound'
  }
  return 'other'
}

export function resolveMarathonTransportPreflight(input: {
  activeNode: string
  cursorConnectionCount: number
}): MarathonTransportPreflightResult {
  const activeNode = input.activeNode.trim()
  const protocolClass = resolveMarathonTransportProtocolClass(activeNode)
  const quicLeafActive = protocolClass === 'quic_inbound'
  const splitBrainRiskClass =
    quicLeafActive || isCursorSuboptimalNode(activeNode) ? 'split_brain_class' : 'none'
  return {
    activeNode,
    protocolClass,
    quicLeafActive,
    splitBrainRiskClass,
    cursorConnectionCount: input.cursorConnectionCount,
  }
}

export function formatMarathonTransportPreflightLogLine(
  result: MarathonTransportPreflightResult,
): string {
  const outcome = result.quicLeafActive ? 'quic_leaf_active' : 'tcp_or_trusted_leaf'
  const risk = result.splitBrainRiskClass === 'split_brain_class' ? 1 : 0
  const gate = result.splitBrainRiskClass === 'split_brain_class' ? 'escalate' : 'none'
  return (
    `[MarathonTransportPreflight]: outcome=${outcome}` +
    ` protocol=${result.protocolClass}` +
    ` node=${result.activeNode}` +
    ` risk=split_brain_class:${risk}` +
    ` gate=${gate}` +
    ` cursor_conn=${result.cursorConnectionCount}\n`
  )
}
