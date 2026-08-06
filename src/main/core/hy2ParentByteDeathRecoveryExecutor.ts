// [INPUT] hy2ParentByteDeathRecoveryCore · mihomoApi
// [OUTPUT] executeByteDeathParentMutation
// [POS] C-8.10 executor — prod-safe leaf close with full logging (no silent catch).

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import {
  buildLeafCloseReport,
  filterHy2LeafConnections,
  formatByteDeathRecoveryLogLine,
  planByteDeathParentMutation,
  type ByteDeathParentMutationPlan,
  type Hy2LeafConnectionCloseReport,
} from './hy2ParentByteDeathRecoveryCore'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'

export interface ByteDeathParentMutationResult {
  plan: ByteDeathParentMutationPlan
  mutated: boolean
  leafReport?: Hy2LeafConnectionCloseReport
  err?: string
}

async function appendRecoveryLog(line: string): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

async function closeUdpOutbound(connectionId: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const { mihomoCloseConnection } = await import('./mihomoApi')
    await mihomoCloseConnection(connectionId)
    return { ok: true }
  } catch (error) {
    return { ok: false, err: formatUnknownErrorForLog(error) }
  }
}

async function fetchFreshConnections(): Promise<ControllerConnectionDetail[]> {
  const { mihomoGetConnections } = await import('./mihomoApi')
  const snapshot = await mihomoGetConnections()
  return snapshot.connections ?? []
}

export async function executeByteDeathParentMutation(input: {
  activeLeaf: string
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  nowMs: number
  maxByteStallMs: number
  cursorConnectionCount: number
}): Promise<ByteDeathParentMutationResult> {
  let connections = input.connections
  try {
    const fresh = await fetchFreshConnections()
    if (fresh.length > 0) {
      connections = fresh
    }
  } catch (error) {
    await appendRecoveryLog(
      formatByteDeathRecoveryLogLine({
        outcome: 'failed',
        action: 'none',
        reason: 'byte_death_refresh_connections_failed',
        maxByteStallMs: input.maxByteStallMs,
        cursorConn: input.cursorConnectionCount,
        err: formatUnknownErrorForLog(error),
      }),
    )
  }

  const diagnostics = resolveHy2ParentUdpOutboundConnectionId({
    connections,
    activeLeaf: input.activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    nowMs: input.nowMs,
    byteDeathFullScan: true,
  })

  await appendRecoveryLog(
    formatByteDeathRecoveryLogLine({
      outcome: 'planned',
      action: 'close_leaf_connections',
      reason: 'byte_death_mutation_planning',
      maxByteStallMs: input.maxByteStallMs,
      cursorConn: input.cursorConnectionCount,
      totalConn: connections.length,
      udpLeafStrict: diagnostics.diagnostics?.udpOnLeafStrict,
      udpFullScan: diagnostics.diagnostics?.udpFullScanCandidates,
    }),
  )

  const plan = planByteDeathParentMutation({
    connections,
    activeLeaf: input.activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    nowMs: input.nowMs,
  })

  if (plan.action === 'close_udp_outbound' && plan.udpConnectionId) {
    const closed = await closeUdpOutbound(plan.udpConnectionId)
    await appendRecoveryLog(
      formatByteDeathRecoveryLogLine({
        outcome: closed.ok ? 'executed' : 'failed',
        action: 'close_udp_outbound',
        reason: `${plan.reason} phase=execute`,
        maxByteStallMs: input.maxByteStallMs,
        cursorConn: input.cursorConnectionCount,
        udpConnectionId: plan.udpConnectionId,
        err: closed.err,
      }),
    )
    return {
      plan,
      mutated: closed.ok,
      err: closed.err,
    }
  }

  if (plan.action === 'close_leaf_connections') {
    const targets = filterHy2LeafConnections(connections, input.activeLeaf)
    const closedIds: string[] = []
    const failedIds: string[] = []
    let batchErr: string | undefined
    try {
      const { mihomoCloseConnection } = await import('./mihomoApi')
      for (const conn of targets) {
        try {
          await mihomoCloseConnection(conn.id)
          closedIds.push(conn.id)
        } catch (error) {
          failedIds.push(conn.id)
          batchErr ??= formatUnknownErrorForLog(error)
        }
      }
    } catch (error) {
      batchErr = formatUnknownErrorForLog(error)
    }
    const leafReport = buildLeafCloseReport({
      activeLeaf: input.activeLeaf,
      connections,
      closedIds,
      failedIds,
      err: batchErr,
    })
    const mutated = leafReport.closedCount > 0
    await appendRecoveryLog(
      formatByteDeathRecoveryLogLine({
        outcome: mutated ? 'executed' : 'failed',
        action: 'close_leaf_connections',
        reason: `${plan.reason} phase=execute`,
        maxByteStallMs: input.maxByteStallMs,
        cursorConn: input.cursorConnectionCount,
        attemptedCount: leafReport.attemptedCount,
        closedCount: leafReport.closedCount,
        sampleChains: leafReport.sampleChains,
        err: leafReport.err,
      }),
    )
    return {
      plan,
      mutated,
      leafReport,
      err: leafReport.err,
    }
  }

  await appendRecoveryLog(
    formatByteDeathRecoveryLogLine({
      outcome: 'failed',
      action: 'none',
      reason: plan.reason,
      maxByteStallMs: input.maxByteStallMs,
      cursorConn: input.cursorConnectionCount,
      totalConn: connections.length,
      udpLeafStrict: diagnostics.diagnostics?.udpOnLeafStrict,
      udpFullScan: diagnostics.diagnostics?.udpFullScanCandidates,
    }),
  )
  return { plan, mutated: false }
}
