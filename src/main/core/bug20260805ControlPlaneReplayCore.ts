// [INPUT] BUG-2026-08-05-001 incident fixtures · pure control-plane cores
// [OUTPUT] runBug20260805ControlPlaneReplayGate
// [POS] 1.30.3 regression gate — replay 8/5 night control-plane failure signatures.

import { evaluateMarathonSSETruth } from './marathonSSETruthCore'
import {
  createInitialDialAdmissionState,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'
import { evaluateRecoveryHonesty } from './recoveryHonestyCore'
import { evaluateMaxStepsRateUpgradeGate } from '../../../scripts/maxStepsRateUpgradeGateCore.ts'

export interface Bug20260805ReplayVerdict {
  fixtureId: string
  ok: boolean
  detail: string
}

export interface Bug20260805ControlPlaneReplayResult {
  ok: boolean
  verdicts: Bug20260805ReplayVerdict[]
}

/** 8/5: cursor_conn=16 while IFM segment handoff lagged → marathon_active=0 blocked Plane B. */
export function replayBug20260805MarathonTruthGate(nowMs: number = 1_785_900_000_000): Bug20260805ReplayVerdict {
  const truth = evaluateMarathonSSETruth({
    nowMs,
    cursorConnectionCount: 16,
    segments: [],
    terminatedSegmentIds: new Set(),
    registry: { records: new Map() },
    lastConnectPathPulseAtMs: 0,
  })
  const ok = truth.marathonTruthActive === true
  return {
    fixtureId: '0805_marathon_truth_cursor_conn16',
    ok,
    detail: ok
      ? 'marathonTruthActive=true at cursor_conn=16 without IFM segments'
      : 'marathonTruthActive still false — Plane B gate blocked',
  }
}

/** 8/5: emergency parent refresh must bypass global_control_inflight (sidecar 18/19 failed). */
export function replayBug20260805EmergencyAdmissionBypass(): Bug20260805ReplayVerdict {
  let state = createInitialDialAdmissionState()
  const blocked = resolveDialAdmission(state, {
    dialId: 'recovery-a',
    class: 'active_recovery',
    caller: 'mtdo.token_gap',
    incidentGeneration: 'token_gap:rid-a:100',
    submittedAtMs: 1,
  })
  state = blocked.nextState
  const emergency = resolveDialAdmission(state, {
    dialId: 'sidecar-emergency',
    class: 'emergency_parent_refresh',
    caller: 'hy2ParentSidecar',
    incidentGeneration: 'parent_refresh:emergency:100',
    submittedAtMs: 2,
  })
  const ok = blocked.admitted === true && emergency.admitted === true
  return {
    fixtureId: '0805_emergency_parent_refresh_bypass',
    ok,
    detail: ok
      ? 'emergency_parent_refresh admitted while active_recovery in-flight'
      : `emergency blocked reason=${emergency.reason}`,
  }
}

/** 8/5: RecoveryHonesty 387 ineffective — probe gap dropped but carrier bytes frozen. */
export function replayBug20260805RecoveryHonestySplitBrain(): Bug20260805ReplayVerdict {
  const evaluation = evaluateRecoveryHonesty({
    record: {
      kind: 'stall_prune',
      attemptedAtMs: 1_000_000,
      baselineMaxGapMs: 188_586,
      staleRequestIds: ['2758ce91'],
      baselineCarrier: { upload: 2458, download: 4972 },
      requireCarrierBytesRecovery: true,
      connectionId: 'conn-8-5-frozen',
    },
    nowMs: 1_040_000,
    currentMaxGapMs: 20_000,
    staleRequestIds: ['2758ce91'],
    currentCarrier: { upload: 2458, download: 4972 },
  })
  const ok = evaluation.outcome === 'ineffective' && evaluation.gapReducedEnough === true
  return {
    fixtureId: '0805_recovery_honesty_split_brain',
    ok,
    detail: ok
      ? 'split-brain marked ineffective despite gap drop'
      : `unexpected outcome=${evaluation.outcome} gap_reduced=${evaluation.gapReducedEnough}`,
  }
}

/** 8/5: attemptRatePct=2% must block upgrade ship when sample sufficient. */
export function replayBug20260805G9UpgradeGateBlock(): Bug20260805ReplayVerdict {
  const gate = evaluateMaxStepsRateUpgradeGate({
    maxStepsLogLine:
      '[MaxStepsRate]: cursor_requests_started=100 cursor_requests_early_disconnect=98 cursor_request_rate_pct=2.0 below_target_attempt=1',
    snapshotAttemptRatePct: null,
  })
  const ok = gate.allowUpgrade === false && gate.attemptRatePct === 2
  return {
    fixtureId: '0805_g9_upgrade_gate_block_2pct',
    ok,
    detail: ok
      ? 'upgrade blocked at attempt_rate_pct=2.0'
      : `gate allowUpgrade=${gate.allowUpgrade} reason=${gate.reason}`,
  }
}

/** F8: observability pulse must defer while rescue control dial is in-flight. */
export function replayBug20260805ObservabilityProbeDefer(): Bug20260805ReplayVerdict {
  let state = createInitialDialAdmissionState()
  const rescue = resolveDialAdmission(state, {
    dialId: 'rescue-1',
    class: 'active_recovery',
    caller: 'marathonRescueDialExecutor',
    incidentGeneration: 'silent_generation_end:rid-b:200',
    submittedAtMs: 1,
  })
  state = rescue.nextState
  const pulse = resolveDialAdmission(state, {
    dialId: 'pulse-1',
    class: 'observability_probe',
    caller: 'marathonTransportDialOrchestrator.connectPathPulse',
    incidentGeneration: 'connect_path_pulse:JP-VPS-HY2:200',
    submittedAtMs: 2,
  })
  const ok =
    rescue.admitted === true &&
    pulse.admitted === false &&
    pulse.reason === 'observability_deferred_control_inflight'
  return {
    fixtureId: '0805_observability_probe_defer',
    ok,
    detail: ok
      ? 'observability_probe deferred during active_recovery'
      : `pulse admitted=${pulse.admitted} reason=${pulse.reason}`,
  }
}

export function runBug20260805ControlPlaneReplayGate(): Bug20260805ControlPlaneReplayResult {
  const verdicts = [
    replayBug20260805MarathonTruthGate(),
    replayBug20260805EmergencyAdmissionBypass(),
    replayBug20260805RecoveryHonestySplitBrain(),
    replayBug20260805G9UpgradeGateBlock(),
    replayBug20260805ObservabilityProbeDefer(),
  ]
  return {
    ok: verdicts.every((verdict) => verdict.ok),
    verdicts,
  }
}
