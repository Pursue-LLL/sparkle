// [INPUT] stallEscalationLadderCore · agentTransportFailureSync
// [OUTPUT] persistStallEscalationLadderJsonl
// [POS] R-41b — SEL events → ~/.sparkle/agent-transport-failures.jsonl for triage SSOT.

import type { StallEscalationLadderAction } from './stallEscalationLadderCore'

export function buildStallEscalationJsonlErrMsg(input: {
  action: StallEscalationLadderAction
  reason: string
  connectionId?: string
  host?: string
  stallMs: number
  upload: number
  download: number
}): string {
  return [
    `[StallEscalationLadder] action=${input.action}`,
    `reason=${input.reason}`,
    input.connectionId ? `connection_id=${input.connectionId}` : '',
    input.host ? `host=${input.host}` : '',
    `stall_ms=${input.stallMs}`,
    `upload=${input.upload}`,
    `download=${input.download}`,
  ]
    .filter(Boolean)
    .join(' ')
}

export async function persistStallEscalationLadderJsonl(input: {
  action: StallEscalationLadderAction
  reason: string
  connectionId?: string
  host?: string
  stallMs: number
  upload: number
  download: number
  leaf: string
  staleRequestIds?: readonly string[]
  cursorConnectionCount: number
  nowMs: number
}): Promise<void> {
  if (input.action === 'none') {
    return
  }
  const staleRid = input.staleRequestIds?.find((rid) => rid.trim().length > 0)?.trim()
  const { appendAgentTransportFailureRow } = await import('./agentTransportFailureSync')
  await appendAgentTransportFailureRow(
    {
      kind: 'sparkle_stall_escalation',
      ts: input.nowMs,
      originalRequestId: staleRid,
      requestId: staleRid,
      proxyNode: input.leaf,
      reasonType: 'proxy-network',
      reasonSub: `stall-escalation-${input.action}`,
      errMsg: buildStallEscalationJsonlErrMsg(input),
      activeAgents: input.cursorConnectionCount,
    },
    input.leaf,
  )
}
