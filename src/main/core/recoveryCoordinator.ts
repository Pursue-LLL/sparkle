// [INPUT] recoveryCoordinatorPolicyCore · perLeafRecoveryCircuitCore
// [OUTPUT] submitRecoveryCoordinatorEvent
// [POS] Phase-1 runtime coordinator — single recovery decision entry for byte-death.

import { appendAppLog } from '../utils/log'
import { mihomoChangeProxy, mihomoGroups } from './mihomoApi'
import { requestEmergencyCoreRecovery } from './emergencyCoreRecovery'
import { unknownLongflowEvidence } from './proxyStackDeadlockCore'
import { notifyRecoveryCircuitSuccess } from './recoveryCircuitBreaker'
import {
  classifyLeafFailureReason,
  createInitialLeafRecoveryCircuitState,
  isLeafRecoveryCircuitOpen,
  leafCircuitKey,
  recordLeafRecoveryFailure,
  recordLeafRecoverySuccess,
  type LeafRecoveryCircuitState,
} from './perLeafRecoveryCircuitCore'
import { resolveHy2ParentUdpOutboundConnectionId } from './hy2ParentCarrierIdentityCore'
import { resolveUdpParentStateForRecovery, shouldSuppressHy2UdpAbsentEscalation } from './recoveryFailoverGovernanceCore'
import { getLastHy2TunnelVitalityAtMs } from './hy2TunnelVitality'
import {
  createInitialRecoveryCoordinatorPolicyState,
  decideRecoveryCoordinatorAction,
  resolveRecoveryActionReason,
  type RecoveryCoordinatorEvent,
  type RecoveryCoordinatorEventType,
  type RecoveryFact,
  type RecoveryCoordinatorPolicyState,
} from './recoveryCoordinatorPolicyCore'
import { CURSOR_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import { resolveLeafFailoverTarget } from './recoveryLeafFailoverCore'
import { writeCursorDedicatedManualSelection } from './cursorDedicatedSelectionCore'

let policyState: RecoveryCoordinatorPolicyState = createInitialRecoveryCoordinatorPolicyState(
  Date.now(),
)
let operationInFlight = false
let generation = 0
const leafCircuits = new Map<string, LeafRecoveryCircuitState>()

export function resetRecoveryCoordinatorForTests(nowMs = Date.now()): void {
  policyState = createInitialRecoveryCoordinatorPolicyState(nowMs)
  operationInFlight = false
  generation = 0
  leafCircuits.clear()
}

export function getRecoveryCoordinatorPolicyStateForTests(): RecoveryCoordinatorPolicyState {
  return { ...policyState }
}

function buildFact(input: {
  leafId: string
  connections: readonly ControllerConnectionDetail[]
  cursorConnectionCount: number
  nowMs: number
  cursorDedicatedActiveLeaf?: string
}): RecoveryFact {
  const resolution = resolveHy2ParentUdpOutboundConnectionId({
    connections: input.connections,
    activeLeaf: input.leafId,
    trackedFirstSeenAtMsById: new Map(),
    nowMs: input.nowMs,
    byteDeathFullScan: true,
  })
  let udpParentState = resolveUdpParentStateForRecovery({
    resolution,
    lastVitalitySuccessAtMs: getLastHy2TunnelVitalityAtMs(),
    nowMs: input.nowMs,
  })
  if (
    udpParentState === 'absent' &&
    shouldSuppressHy2UdpAbsentEscalation({
      hy2LeafId: input.leafId,
      cursorDedicatedActiveLeaf: input.cursorDedicatedActiveLeaf,
    })
  ) {
    udpParentState = 'unknown'
  }
  return {
    leafId: input.leafId,
    observedAt: input.nowMs,
    generation,
    stallState: udpParentState === 'absent' ? 'confirmed' : 'suspected',
    udpParentState,
    cursorConnectionCount: input.cursorConnectionCount,
    providerReady: true,
    tunReady: true,
    proxyReady: true,
  }
}

function mapUdpStateToEventType(
  udpParentState: RecoveryFact['udpParentState'],
): RecoveryCoordinatorEventType | undefined {
  if (udpParentState === 'absent') {
    return 'UDP_PARENT_ABSENT'
  }
  if (udpParentState === 'unknown') {
    return 'UDP_PARENT_UNKNOWN'
  }
  return undefined
}

export async function submitRecoveryCoordinatorEvent(input: {
  event: RecoveryCoordinatorEvent
  connections: readonly ControllerConnectionDetail[]
  cursorConnectionCount: number
  nowMs?: number
}): Promise<{ handled: boolean; reason: string }> {
  if (operationInFlight) {
    return { handled: false, reason: 'recovery_operation_in_flight' }
  }
  const nowMs = input.nowMs ?? Date.now()
  const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
  const cursorDedicatedActiveLeaf = await resolveCursorDedicatedActiveNode()
  const fact = buildFact({
    leafId: input.event.leafId,
    connections: input.connections,
    cursorConnectionCount: input.cursorConnectionCount,
    nowMs,
    cursorDedicatedActiveLeaf: cursorDedicatedActiveLeaf ?? undefined,
  })
  const failureClass = classifyLeafFailureReason(input.event.detail ?? input.event.type)
  const circuitKey = leafCircuitKey({ leafId: input.event.leafId, failureClass })
  const circuit = leafCircuits.get(circuitKey) ?? createInitialLeafRecoveryCircuitState()
  if (isLeafRecoveryCircuitOpen({ nowMs, state: circuit })) {
    return { handled: false, reason: `leaf_circuit_open key=${circuitKey}` }
  }

  operationInFlight = true
  generation += 1
  const event = { ...input.event, generation, observedAt: nowMs }
  try {
    const decision = decideRecoveryCoordinatorAction({
      state: policyState,
      fact,
      event,
      nowMs,
    })
    policyState = decision.state
    await appendAppLog(
      `[RecoveryCoordinator]: event=${event.type} leaf=${event.leafId} action=${decision.action.kind} reason=${resolveRecoveryActionReason(decision.action)}\n`,
    )

    if (decision.action.kind === 'request_emergency_core_recovery') {
      const result = await requestEmergencyCoreRecovery({
        reason: 'confirmed_udp_parent_absent',
        leafId: decision.action.leafId,
        evidenceReason: decision.action.evidenceReason,
        cursorConnectionCount: input.cursorConnectionCount,
        longflow: unknownLongflowEvidence('recovery_coordinator_no_longevity_snapshot'),
        nowMs,
      })
      if (!result.executed) {
        const failure = recordLeafRecoveryFailure({
          nowMs,
          state: circuit,
          reason: result.reason,
        })
        leafCircuits.set(circuitKey, failure.state)
        return { handled: false, reason: result.reason }
      }
      await notifyRecoveryCircuitSuccess()
      leafCircuits.set(circuitKey, recordLeafRecoverySuccess(circuit))
      return { handled: true, reason: result.reason }
    }

    if (decision.action.kind === 'failover_leaf') {
      const groups = await mihomoGroups()
      const cursorGroup = groups.find((group) => group.name === CURSOR_DEDICATED_GROUP_NAME)
      const members =
        cursorGroup?.all
          .map((proxy) => proxy?.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0) ?? []
      const target = resolveLeafFailoverTarget({
        failedLeafId: decision.action.leafId,
        availableMembers: members,
      })
      if (!target) {
        return { handled: false, reason: 'failover_target_unavailable' }
      }
      const changed = await mihomoChangeProxy(CURSOR_DEDICATED_GROUP_NAME, target, {
        source: 'recovery_coordinator',
      })
      if (changed) {
        policyState = {
          ...policyState,
          failoverAttempted: true,
          lastFailoverCompletedAtMs: nowMs,
        }
        await writeCursorDedicatedManualSelection(target)
        await notifyRecoveryCircuitSuccess()
      }
      await appendAppLog(
        `[RecoveryCoordinator]: outcome=${changed ? 'executed' : 'failed'} action=failover_leaf leaf=${decision.action.leafId} target=${target} reason=${decision.action.reason} failover_dispatch_count=${policyState.failoverDispatchCount}\n`,
      )
      return {
        handled: changed,
        reason: changed ? `failover_to_${target}` : 'failover_change_proxy_failed',
      }
    }

    return { handled: decision.action.kind !== 'none', reason: decision.action.reason }
  } finally {
    operationInFlight = false
  }
}

export async function submitByteDeathRecoveryEvent(input: {
  leafId: string
  connections: readonly ControllerConnectionDetail[]
  cursorConnectionCount: number
  detail?: string
  nowMs?: number
}): Promise<{ handled: boolean; reason: string }> {
  const nowMs = input.nowMs ?? Date.now()
  const { resolveCursorDedicatedActiveNode } = await import('./cursorDedicatedNodeResolver')
  const cursorDedicatedActiveLeaf = await resolveCursorDedicatedActiveNode()
  const fact = buildFact({
    leafId: input.leafId,
    connections: input.connections,
    cursorConnectionCount: input.cursorConnectionCount,
    nowMs,
    cursorDedicatedActiveLeaf: cursorDedicatedActiveLeaf ?? undefined,
  })
  const mapped = mapUdpStateToEventType(fact.udpParentState)
  const eventType: RecoveryCoordinatorEventType =
    mapped ??
    (input.detail?.includes('byte_death_udp_evidence_insufficient')
      ? 'UDP_PARENT_UNKNOWN'
      : input.detail?.includes('probe_only')
      ? 'PROBE_ONLY_RESULT'
      : 'STALL_DETECTED')
  return submitRecoveryCoordinatorEvent({
    event: {
      type: eventType,
      leafId: input.leafId,
      generation: 0,
      observedAt: nowMs,
      detail: input.detail,
    },
    connections: input.connections,
    cursorConnectionCount: input.cursorConnectionCount,
    nowMs,
  })
}
