// [INPUT] none — frozen replay fixtures for Phase 10 baseline gate (P10-0)
// [OUTPUT] P10 baseline fixture constants + evaluateP10BaselineVerdict
// [POS] SSOT §M.0.15.11 P10-0 — reproducible verdicts without mutating production behavior.

export const P10_BAD_RULER_FIXTURE = {
  ledgerHttpSegmentStarted: 239,
  ledgerStreamTerminated: 160,
  ledgerStreamActivity: 475_326,
  ledgerNetworkStarted: 0,
  ledgerMaxStepsReached: 0,
  rolling100EarlyDisconnect: 100,
  rolling100MaxSteps: 0,
} as const

export const P10_0730_UNSUPPORTED_REGION_GOLDEN = {
  outerCode: 8,
  outerMessage: 'resource_exhausted',
  innerErrorCode: 64,
  innerSubtype: 'ERROR_UNSUPPORTED_REGION',
  isRetryable: false,
  actionRequired: 'change_model',
  expectedProjection: 'unsupported_region',
  mustNotProjectAs: 'true_resource_exhausted',
} as const

export const P10_0801_DIAL_STORM_GOLDEN = {
  windowMinutes: 93,
  pulseCount: 348,
  rescueNudgeCount: 210,
  recoveryIneffectiveCount: 167,
  expectedVerdict: 'L2_L3_control_plane_self_excitation',
} as const

export const P10_0721_CODE8_UNKNOWN_GOLDEN = {
  historicalCode8Rows: 359,
  innerDetailsAvailable: false,
  expectedProjection: 'unknown_code8',
  mustNotProjectAs: 'cursor_server_definitive',
} as const

export type P10BaselineFixtureId =
  | 'bad_ruler'
  | '0730_unsupported_region'
  | '0801_dial_storm'
  | '0721_code8_unknown'

export interface P10BaselineVerdict {
  fixtureId: P10BaselineFixtureId
  ok: boolean
  detail: string
}

export function evaluateP10BadRulerFixture(
  observed: typeof P10_BAD_RULER_FIXTURE = P10_BAD_RULER_FIXTURE,
): P10BaselineVerdict {
  const invalid =
    observed.ledgerNetworkStarted === 0 &&
    (observed.ledgerHttpSegmentStarted > 0 || observed.rolling100EarlyDisconnect > 0)
  return {
    fixtureId: 'bad_ruler',
    ok: invalid,
    detail: invalid
      ? 'physical ruler invalid — requestId/segment proxy cannot represent network starts'
      : 'expected invalid bad-ruler fixture',
  }
}

export function evaluateP10UnsupportedRegionGolden(
  innerSubtype: string | undefined,
): P10BaselineVerdict {
  const ok = innerSubtype === P10_0730_UNSUPPORTED_REGION_GOLDEN.innerSubtype
  return {
    fixtureId: '0730_unsupported_region',
    ok,
    detail: ok
      ? 'unsupported_region preserved from ErrorDetails'
      : `expected inner subtype ${P10_0730_UNSUPPORTED_REGION_GOLDEN.innerSubtype}, got ${innerSubtype ?? 'missing'}`,
  }
}

export function evaluateP10Code8UnknownGolden(hasInnerDetails: boolean): P10BaselineVerdict {
  const ok = !hasInnerDetails
  return {
    fixtureId: '0721_code8_unknown',
    ok,
    detail: ok
      ? 'missing inner details remain unknown_code8'
      : 'must not invent inner subtype when details absent',
  }
}
