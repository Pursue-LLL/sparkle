// [INPUT] hy2ParentByteDeathRecoveryCore · hy2ParentCarrierIdentityCore
// [OUTPUT] executeByteDeathParentMutationWithDeps · executeLeafCloseBatch
// [POS] C-8.12 impl — electron-free; runtime wrapper supplies static mihomo imports.

import { formatUnknownErrorForLog } from '../utils/formatUnknownErrorForLog'
import {
  buildLeafCloseReport,
  formatByteDeathRecoveryLogLine,
  isByteDeathUdpParentAbsent,
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
  lastVitalitySuccessAtMs?: number
}

export type CloseConnectionFn = (connectionId: string) => Promise<void>
export type ResetParentBirthFn = (activeLeaf: string, nowMs: number) => Promise<void>

export interface ByteDeathParentMutationDeps {
  closeFn: CloseConnectionFn
  fetchConnections: () => Promise<ControllerConnectionDetail[]>
  appendLog: (line: string) => Promise<void>
  resetParentBirth: ResetParentBirthFn
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

export async function executeByteDeathParentMutationWithDeps(
  input: ByteDeathParentMutationInput,
  deps: ByteDeathParentMutationDeps,
): Promise<ByteDeathParentMutationResult> {
  const { closeFn, fetchConnections, appendLog: log, resetParentBirth } = deps

  let connections = input.connections
  try {
    const fresh = await fetchConnections()
    if (fresh.length > 0) {
      connections = fresh
    }
  } catch (error) {
    const err = formatUnknownErrorForLog(error)
    await log(
      formatByteDeathRecoveryLogLine({
        outcome: 'failed',
        action: 'none',
        reason: 'byte_death_refresh_connections_failed',
        maxByteStallMs: input.maxByteStallMs,
        cursorConn: input.cursorConnectionCount,
        err,
      }),
    )
    return {
      plan: { action: 'none', reason: 'byte_death_refresh_connections_failed' },
      mutated: false,
      err,
    }
  }

  const diagnostics = resolveHy2ParentUdpOutboundConnectionId({
    connections,
    activeLeaf: input.activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    nowMs: input.nowMs,
    byteDeathFullScan: true,
  })

  const plan = planByteDeathParentMutation({
    connections,
    activeLeaf: input.activeLeaf,
    trackedFirstSeenAtMsById: input.trackedFirstSeenAtMsById,
    trackedLastByteChangeAtMsById: input.trackedLastByteChangeAtMsById,
    nowMs: input.nowMs,
    lastVitalitySuccessAtMs: input.lastVitalitySuccessAtMs,
  })

  await log(
    formatByteDeathRecoveryLogLine({
      outcome: 'planned',
      action: plan.action,
      reason: 'byte_death_mutation_planning',
      maxByteStallMs: input.maxByteStallMs,
      cursorConn: input.cursorConnectionCount,
      totalConn: connections.length,
      udpLeafStrict: diagnostics.diagnostics?.udpOnLeafStrict,
      udpFullScan: diagnostics.diagnostics?.udpFullScanCandidates,
    }),
  )

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

  if (plan.action === 'reset_parent_chain_birth') {
    try {
      await resetParentBirth(input.activeLeaf, input.nowMs)
      await log(
        formatByteDeathRecoveryLogLine({
          outcome: 'executed',
          action: 'reset_parent_chain_birth',
          reason: `${plan.reason} phase=execute`,
          maxByteStallMs: input.maxByteStallMs,
          cursorConn: input.cursorConnectionCount,
          totalConn: connections.length,
          udpLeafStrict: diagnostics.diagnostics?.udpOnLeafStrict,
          udpFullScan: diagnostics.diagnostics?.udpFullScanCandidates,
        }),
      )
      return { plan, mutated: true }
    } catch (error) {
      const err = formatUnknownErrorForLog(error)
      await log(
        formatByteDeathRecoveryLogLine({
          outcome: 'failed',
          action: 'reset_parent_chain_birth',
          reason: `${plan.reason} phase=execute`,
          maxByteStallMs: input.maxByteStallMs,
          cursorConn: input.cursorConnectionCount,
          err,
        }),
      )
      return { plan, mutated: false, err }
    }
  }

  if (plan.action === 'close_leaf_connections') {
    if (
      isByteDeathUdpParentAbsent(diagnostics, {
        lastVitalitySuccessAtMs: input.lastVitalitySuccessAtMs,
        nowMs: input.nowMs,
      })
    ) {
      const escalateReason = 'byte_death_udp_absent_requires_core_restart'
      await log(
        formatByteDeathRecoveryLogLine({
          outcome: 'failed',
          action: 'none',
          reason: `${escalateReason} collateral_gate_blocked`,
          maxByteStallMs: input.maxByteStallMs,
          cursorConn: input.cursorConnectionCount,
          udpLeafStrict: diagnostics.diagnostics?.udpOnLeafStrict,
          udpFullScan: diagnostics.diagnostics?.udpFullScanCandidates,
        }),
      )
      return {
        plan: { action: 'none', reason: escalateReason },
        mutated: false,
      }
    }
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
