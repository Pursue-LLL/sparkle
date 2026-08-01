// [INPUT] p10BaselineFixturesCore · physicalMaxStepsRateCore · dialAdmissionArbiterCore
// [OUTPUT] runP10ReplayGate · evaluateP10DialStormGolden
// [POS] P10-6 SSOT — frozen historical replay gate before fault/soak matrix.

import {
  evaluateP10BadRulerFixture,
  evaluateP10Code8UnknownGolden,
  evaluateP10UnsupportedRegionGolden,
  P10_0801_DIAL_STORM_GOLDEN,
  type P10BaselineVerdict,
} from './p10BaselineFixturesCore'
import { computePhysicalMaxStepsRateSnapshot } from './physicalMaxStepsRateCore'
import {
  createInitialDialAdmissionState,
  markDialAdmissionOutcome,
  resolveDialAdmission,
} from './dialAdmissionArbiterCore'

export interface P10ReplayGateInput {
  innerSubtype0730?: string
  code8HasInnerDetails?: boolean
  dialStormObserved?: {
    pulseCount: number
    rescueNudgeCount: number
    recoveryIneffectiveCount: number
    windowMinutes: number
  }
  physicalStartsCount?: number
  ledgerHttpSegmentStarted?: number
}

export interface P10ReplayGateResult {
  ok: boolean
  verdicts: P10BaselineVerdict[]
  nextGateAllowed: boolean
}

export function evaluateP10DialStormGolden(input: {
  pulseCount: number
  rescueNudgeCount: number
  recoveryIneffectiveCount: number
  windowMinutes: number
}): P10BaselineVerdict {
  const golden = P10_0801_DIAL_STORM_GOLDEN
  const stormLike =
    input.windowMinutes <= golden.windowMinutes + 10 &&
    input.pulseCount >= golden.pulseCount * 0.9 &&
    input.rescueNudgeCount >= golden.rescueNudgeCount * 0.9 &&
    input.recoveryIneffectiveCount >= golden.recoveryIneffectiveCount * 0.9
  return {
    fixtureId: '0801_dial_storm',
    ok: stormLike,
    detail: stormLike
      ? golden.expectedVerdict
      : `expected dial storm profile pulse>=${golden.pulseCount} rescue>=${golden.rescueNudgeCount}`,
  }
}

export function evaluateP10AdmissionStormMitigation(): P10BaselineVerdict {
  let state = createInitialDialAdmissionState()
  const incident = 'connect_partition:rid-storm:99'
  const first = resolveDialAdmission(state, {
    dialId: 'd1',
    class: 'active_recovery',
    caller: 'mtdo',
    incidentGeneration: incident,
    submittedAtMs: 1,
  })
  state = markDialAdmissionOutcome(first.nextState, 'd1', incident, 'INEFFECTIVE')
  const second = resolveDialAdmission(state, {
    dialId: 'd2',
    class: 'active_recovery',
    caller: 'mtdo',
    incidentGeneration: incident,
    submittedAtMs: 2,
  })
  const ok = first.admitted === true && second.admitted === false
  return {
    fixtureId: '0801_dial_storm',
    ok,
    detail: ok
      ? 'admission arbiter closes ineffective incident generation'
      : 'expected second dial blocked after INEFFECTIVE',
  }
}

export function runP10ReplayGate(input: P10ReplayGateInput = {}): P10ReplayGateResult {
  const verdicts: P10BaselineVerdict[] = [
    evaluateP10BadRulerFixture(),
    evaluateP10UnsupportedRegionGolden(input.innerSubtype0730 ?? 'ERROR_UNSUPPORTED_REGION'),
    evaluateP10Code8UnknownGolden(input.code8HasInnerDetails ?? false),
    evaluateP10AdmissionStormMitigation(),
  ]
  if (input.dialStormObserved) {
    verdicts.push(evaluateP10DialStormGolden(input.dialStormObserved))
  }
  const startsCount = input.physicalStartsCount ?? 0
  const physical = computePhysicalMaxStepsRateSnapshot({
    starts: Array.from({ length: startsCount }, (_, index) => ({
      networkStartId: `net-${index}`,
      rendererBootId: 'boot-fixture',
      startedAtMs: 1_000 + index,
      outcome: 'max_steps' as const,
      closedAtMs: 2_000 + index,
    })),
    ledgerHttpSegmentStarted: input.ledgerHttpSegmentStarted ?? 0,
  })
  verdicts.push({
    fixtureId: 'bad_ruler',
    ok: startsCount === 0 ? physical.valid === false : physical.valid === true,
    detail:
      startsCount === 0
        ? `physical invalid as expected (${physical.invalidReason ?? 'none'})`
        : `physical valid when network_started present (${physical.physicalRatePct}%)`,
  })
  const ok = verdicts.every((verdict) => verdict.ok)
  return { ok, verdicts, nextGateAllowed: ok }
}
