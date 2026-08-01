// [INPUT] physical network start records (networkStartId SSOT)
// [OUTPUT] computePhysicalMaxStepsRateSnapshot
// [POS] P10-5 SSOT — rolling100 physical max-steps; invalid until network_started coverage=100%.

export const PHYSICAL_MAX_STEPS_RATE_ROLLING_LIMIT = 100
export const PHYSICAL_MAX_STEPS_RATE_TARGET_PCT = 90

export type PhysicalStreamOutcome =
  | 'max_steps'
  | 'turn_ended'
  | 'transport_error'
  | 'application_reject'
  | 'process_lost'
  | 'user_stop'
  | 'unknown'
  | 'in_progress'

export type PhysicalNetworkStartOrigin =
  | 'manual'
  | 'stock_retry'
  | 'stock_reconnect'
  | 'stock_resume'
  | 'auto_continue'
  | 'unknown'

export interface PhysicalNetworkStartRecord {
  networkStartId: string
  rendererBootId: string
  composerId?: string
  startedAtMs: number
  outcome?: PhysicalStreamOutcome
  closedAtMs?: number
  origin?: PhysicalNetworkStartOrigin
}

export interface PhysicalMaxStepsRateSnapshot {
  valid: boolean
  invalidReason?: string
  windowLabel: string
  cohortSize: number
  closedCount: number
  inProgressCount: number
  maxStepsCount: number
  physicalRatePct: number | null
  coveragePct: number
  belowTarget: boolean
  targetPct: number
  networkStartedTotal: number
  ledgerHttpSegmentStarted: number
}

export function evaluatePhysicalRulerValidity(input: {
  networkStartedCount: number
  ledgerHttpSegmentStarted: number
}): { valid: boolean; invalidReason?: string } {
  if (input.networkStartedCount === 0 && input.ledgerHttpSegmentStarted > 0) {
    return {
      valid: false,
      invalidReason: 'bad_ruler_no_network_started',
    }
  }
  if (input.networkStartedCount === 0) {
    return { valid: false, invalidReason: 'no_physical_starts' }
  }
  return { valid: true }
}

function pct(maxSteps: number, closed: number): number | null {
  if (closed <= 0) {
    return null
  }
  return Math.round((maxSteps / closed) * 1000) / 10
}

export function computePhysicalMaxStepsRateSnapshot(input: {
  starts: readonly PhysicalNetworkStartRecord[]
  ledgerHttpSegmentStarted?: number
  nowMs?: number
  rollingLimit?: number
}): PhysicalMaxStepsRateSnapshot {
  const rollingLimit = input.rollingLimit ?? PHYSICAL_MAX_STEPS_RATE_ROLLING_LIMIT
  const ledgerHttpSegmentStarted = input.ledgerHttpSegmentStarted ?? 0
  const validity = evaluatePhysicalRulerValidity({
    networkStartedCount: input.starts.length,
    ledgerHttpSegmentStarted,
  })

  const sorted = [...input.starts].sort((a, b) => b.startedAtMs - a.startedAtMs)
  const cohort = sorted.slice(0, rollingLimit)
  let closedCount = 0
  let inProgressCount = 0
  let maxStepsCount = 0
  for (const row of cohort) {
    const outcome = row.outcome ?? 'in_progress'
    if (outcome === 'in_progress') {
      inProgressCount += 1
      continue
    }
    closedCount += 1
    if (outcome === 'max_steps') {
      maxStepsCount += 1
    }
  }

  const coveragePct =
    cohort.length > 0 ? Math.round((closedCount / cohort.length) * 1000) / 10 : 0
  const physicalRatePct = pct(maxStepsCount, closedCount)
  const fullyValid =
    validity.valid && cohort.length > 0 && closedCount === cohort.length && coveragePct === 100
  const invalidReason = fullyValid
    ? undefined
    : validity.invalidReason ??
      (closedCount < cohort.length ? 'incomplete_outcomes_in_cohort' : validity.invalidReason)

  const belowTarget =
    fullyValid &&
    physicalRatePct != null &&
    physicalRatePct < PHYSICAL_MAX_STEPS_RATE_TARGET_PCT

  return {
    valid: fullyValid,
    invalidReason,
    windowLabel: `physical_rolling${rollingLimit}`,
    cohortSize: cohort.length,
    closedCount,
    inProgressCount,
    maxStepsCount,
    physicalRatePct,
    coveragePct,
    belowTarget,
    targetPct: PHYSICAL_MAX_STEPS_RATE_TARGET_PCT,
    networkStartedTotal: input.starts.length,
    ledgerHttpSegmentStarted,
  }
}

export function formatPhysicalMaxStepsRateLogSuffix(snapshot: PhysicalMaxStepsRateSnapshot): string {
  const rate =
    snapshot.physicalRatePct == null ? 'invalid' : snapshot.physicalRatePct.toFixed(1)
  return (
    ` physical_valid=${snapshot.valid ? 1 : 0}` +
    ` physical_invalid_reason=${snapshot.invalidReason ?? 'none'}` +
    ` physical_started=${snapshot.networkStartedTotal}` +
    ` physical_closed=${snapshot.closedCount}` +
    ` physical_max_steps=${snapshot.maxStepsCount}` +
    ` physical_rate_pct=${rate}` +
    ` physical_coverage_pct=${snapshot.coveragePct.toFixed(1)}` +
    ` ledger_http_segment_started=${snapshot.ledgerHttpSegmentStarted}` +
    ` below_target_physical=${snapshot.belowTarget ? 1 : 0}`
  )
}
