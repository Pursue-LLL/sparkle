// [INPUT] recoveryCoordinatorPolicyCore · emergencyCoreRecoveryCore · perLeafRecoveryCircuitCore
// [OUTPUT] runRecoveryFaultInjectionGate
// [POS] Phase-1 fault matrix — pure policy assertions for recovery invariants.

import {
  createInitialRecoveryCoordinatorPolicyState,
  decideRecoveryCoordinatorAction,
  type RecoveryFact,
} from './recoveryCoordinatorPolicyCore'
import {
  buildEmergencyCoreRecoveryDeadline,
  evaluateEmergencyCoreRecoveryAdmission,
} from './emergencyCoreRecoveryCore'
import {
  createInitialLeafRecoveryCircuitState,
  isLeafRecoveryCircuitOpen,
  leafCircuitKey,
  recordLeafRecoveryFailure,
} from './perLeafRecoveryCircuitCore'
import { BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART } from './hy2ParentByteDeathRecoveryCore'
import { evaluateByteDeathRecoveryHonesty } from './recoveryByteDeathVerifierCore'

export interface RecoveryFaultInjectionGateResult {
  ok: boolean
  cases: Array<{ name: string; ok: boolean; detail: string }>
}

function baseFact(overrides: Partial<RecoveryFact> = {}): RecoveryFact {
  return {
    leafId: 'JP-VPS-HY2',
    observedAt: 10_000,
    generation: 1,
    stallState: 'confirmed',
    udpParentState: 'absent',
    cursorConnectionCount: 0,
    providerReady: true,
    tunReady: true,
    proxyReady: true,
    ...overrides,
  }
}

export function runRecoveryFaultInjectionGate(): RecoveryFaultInjectionGateResult {
  const cases: RecoveryFaultInjectionGateResult['cases'] = []
  const nowMs = 10_000

  const udpAbsent = decideRecoveryCoordinatorAction({
    state: createInitialRecoveryCoordinatorPolicyState(nowMs),
    fact: baseFact({ udpParentState: 'absent' }),
    event: {
      type: 'UDP_PARENT_ABSENT',
      leafId: 'JP-VPS-HY2',
      generation: 1,
      observedAt: nowMs,
    },
    nowMs,
  })
  cases.push({
    name: 'udp_parent_absent_emergency_recovery',
    ok: udpAbsent.action.kind === 'request_emergency_core_recovery',
    detail: `action=${udpAbsent.action.kind}`,
  })

  const unknown = decideRecoveryCoordinatorAction({
    state: createInitialRecoveryCoordinatorPolicyState(nowMs),
    fact: baseFact({ udpParentState: 'unknown' }),
    event: {
      type: 'UDP_PARENT_UNKNOWN',
      leafId: 'JP-VPS-HY2',
      generation: 1,
      observedAt: nowMs,
    },
    nowMs,
  })
  cases.push({
    name: 'udp_parent_unknown_no_mutation',
    ok: unknown.action.kind === 'none',
    detail: unknown.action.reason,
  })

  const probeOnly = decideRecoveryCoordinatorAction({
    state: createInitialRecoveryCoordinatorPolicyState(nowMs),
    fact: baseFact({ udpParentState: 'present' }),
    event: {
      type: 'PROBE_ONLY_RESULT',
      leafId: 'JP-VPS-HY2',
      generation: 1,
      observedAt: nowMs,
    },
    nowMs,
  })
  cases.push({
    name: 'probe_only_triggers_emergency_not_recovered',
    ok: probeOnly.action.kind === 'request_emergency_core_recovery',
    detail: probeOnly.action.kind,
  })

  const probeHonesty = evaluateByteDeathRecoveryHonesty({
    record: {
      leafId: 'JP-VPS-HY2',
      attemptedAtMs: 1000,
      udpParentClosed: false,
      baselineMaxByteStallMs: 60_000,
    },
    nowMs: 8000,
    currentMaxByteStallMs: 1000,
    api2ProbeOk: true,
  })
  cases.push({
    name: 'probe_only_honesty_ineffective',
    ok: probeHonesty.outcome === 'ineffective',
    detail: probeHonesty.reason,
  })

  const emergencyAdmission = evaluateEmergencyCoreRecoveryAdmission({
    request: {
      reason: 'confirmed_udp_parent_absent',
      leafId: 'JP-VPS-HY2',
      evidenceReason: BYTE_DEATH_UDP_ABSENT_REQUIRES_CORE_RESTART,
      cursorConnectionCount: 26,
      requestedAtMs: nowMs,
      deadlineMs: buildEmergencyCoreRecoveryDeadline(nowMs),
    },
    nowMs: nowMs + 1000,
  })
  cases.push({
    name: 'cursor_conn_gt_zero_limited_drain_not_blocked',
    ok: emergencyAdmission.admitted && emergencyAdmission.drainMs > 0,
    detail: `admitted=${emergencyAdmission.admitted} drain_ms=${emergencyAdmission.drainMs}`,
  })

  let leafCircuit = createInitialLeafRecoveryCircuitState()
  for (let i = 0; i < 3; i += 1) {
    leafCircuit = recordLeafRecoveryFailure({
      nowMs: nowMs + i * 1000,
      state: leafCircuit,
      reason: 'byte_death_probe_only',
    }).state
  }
  const leafOpen = isLeafRecoveryCircuitOpen({ nowMs: nowMs + 5000, state: leafCircuit })
  cases.push({
    name: 'single_leaf_circuit_open_isolated',
    ok: leafOpen,
    detail: `key=${leafCircuitKey({ leafId: 'JP-VPS-HY2', failureClass: 'probe_only' })}`,
  })

  const staleGen = decideRecoveryCoordinatorAction({
    state: { ...createInitialRecoveryCoordinatorPolicyState(nowMs), activeGeneration: 5 },
    fact: baseFact(),
    event: {
      type: 'UDP_PARENT_ABSENT',
      leafId: 'JP-VPS-HY2',
      generation: 2,
      observedAt: nowMs,
    },
    nowMs,
  })
  cases.push({
    name: 'stale_generation_discarded',
    ok: staleGen.action.reason === 'stale_generation_discarded',
    detail: staleGen.action.reason,
  })

  const ok = cases.every((item) => item.ok)
  return { ok, cases }
}
