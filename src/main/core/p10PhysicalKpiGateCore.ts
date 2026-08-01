// [INPUT] physical network start records + ledger segment count
// [OUTPUT] runP10PhysicalKpiGate
// [POS] P10-5 deploy gate — rolling100 physical SLO; rejects bad ruler and incomplete cohort.

import { P10_BAD_RULER_FIXTURE } from './p10BaselineFixturesCore'
import {
  computePhysicalMaxStepsRateSnapshot,
  PHYSICAL_MAX_STEPS_RATE_TARGET_PCT,
  type PhysicalMaxStepsRateSnapshot,
  type PhysicalNetworkStartRecord,
} from './physicalMaxStepsRateCore'

export interface P10PhysicalKpiGateResult {
  ok: boolean
  snapshot: PhysicalMaxStepsRateSnapshot
  detail: string
}

export function runP10PhysicalKpiGate(input: {
  starts: readonly PhysicalNetworkStartRecord[]
  ledgerHttpSegmentStarted: number
}): P10PhysicalKpiGateResult {
  const snapshot = computePhysicalMaxStepsRateSnapshot({
    starts: input.starts,
    ledgerHttpSegmentStarted: input.ledgerHttpSegmentStarted,
  })
  const ok =
    snapshot.valid &&
    !snapshot.belowTarget &&
    snapshot.physicalRatePct != null &&
    snapshot.physicalRatePct >= PHYSICAL_MAX_STEPS_RATE_TARGET_PCT
  const detail = ok
    ? `physical rolling100=${snapshot.physicalRatePct}% coverage=${snapshot.coveragePct}%`
    : snapshot.invalidReason ??
      (snapshot.belowTarget
        ? `below_target physical_rate=${snapshot.physicalRatePct ?? 'null'}`
        : 'physical_kpi_invalid')
  return { ok, snapshot, detail }
}

export function runP10PhysicalKpiGateForBaselineFixture(): P10PhysicalKpiGateResult {
  return runP10PhysicalKpiGate({
    starts: [],
    ledgerHttpSegmentStarted: P10_BAD_RULER_FIXTURE.ledgerHttpSegmentStarted,
  })
}
