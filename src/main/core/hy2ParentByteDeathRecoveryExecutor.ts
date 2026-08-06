// [INPUT] hy2ParentByteDeathRecoveryCore · mihomoApi
// [OUTPUT] executeByteDeathParentMutation
// [POS] C-8.11 executor — surgical leaf close batch + full logging (no silent catch).

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import {
  buildLeafCloseReport,
  formatByteDeathRecoveryLogLine,
  planByteDeathParentMutation,
  selectByteDeathLeafCloseTargets,
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

export interface ByteDeathParentMutationInput {
  activeLeaf: string
  connections: readonly ControllerConnectionDetail[]
  trackedFirstSeenAtMsById: ReadonlyMap<string, number>
  trackedLastByteChangeAtMsById: ReadonlyMap<string, number>
  nowMs: number
  maxByteStallMs: number
  cursorConnectionCount: number
}

type CloseConnectionFn = (connectionId: string) => Promise<void>

async function appendRecoveryLog(line: string): Promise<void> {
  const { appendAppLog } = await import('../utils/log')
  await appendAppLog(line)
}

async function defaultCloseConnection(connectionId: string): Promise<void> {
  const { mihomoCloseConnection } = await import('./mihomoApi')
  await mihomoCloseConnection(connectionId)
}

async function closeUdpOutbound(
  connectionId: string,
  closeFn: CloseConnectionFn,
): Promise<{ ok: boolean; err?: string }> {
  try {
    await closeFn(connectionId)
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

export async function executeLeafCloseBatch(input: {
  targets: readonly ControllerConnectionDetail[]
  closeFn: CloseConnectionFn
}): Promise<{ closedIds: string[]; failedIds: string[]; err?: string }> {
  const closedIds: string[] = []
  const failedIds: string[] = []
  let batchErr: string | undefined
  for (const connection of input.targets) {
    try {
      await input.closeFn(connection.id)
      closedIds.push(connection.id)
    } catch (error) {
      failedIds.push(connection.id)
      batchErr ??= formatUnknownErrorForLog(error)
    }
  }
  return { closedIds, failedIds, err: batchErr }
}

export async function executeByteDeathParentMutation(
  input: ByteDeathParentMutationInput,
  deps?: {
    closeFn?: CloseConnectionFn
    fetchConnections?: () => Promise<ControllerConnectionDetail[]>
    appendLog?: (line: string) => Promise<void>
  },
): Promise<ByteDeathParentMutationResult> {
  const closeFn = deps?.closeFn ?? defaultCloseConnection
  const fetchConnections = deps?.fetchConnections ?? fetchFreshConnections
  const log = deps?.appendLog ?? appendRecoveryLog

  let connections = input.connections
  try {
    const fresh = await fetchConnections()
    if (fresh.length > 0) {
      connections = fresh
    }
  } catch (error) {
    await log(
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

  await log(
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
    trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
    nowMs: input.nowMs,
  })

  if (plan.action === 'close_udp_outbound' && plan.udpConnectionId) {
    const closed = await closeUdpOutbound(plan.udpConnectionId, closeFn)
    await log(
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
    const targets = selectByteDeathLeafCloseTargets({
      connections,
      activeLeaf: input.activeLeaf,
      trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
      nowMs: input.nowMs,
    })
    const batch = await executeLeafCloseBatch({ targets, closeFn })
    const leafReport = buildLeafCloseReport({
      activeLeaf: input.activeLeaf,
      targets,
      closedIds: batch.closedIds,
      failedIds: batch.failedIds,
      err: batch.err,
    })
    const mutated = leafReport.closedCount > 0
    await log(
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

  await log(
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
