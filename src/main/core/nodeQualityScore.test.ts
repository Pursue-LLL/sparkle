import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BADGE_MAX_JITTER_MS,
  BADGE_MAX_SLOW500_RATE,
  BADGE_MIN_SUCCESS_RATE,
  computeProbeMetrics,
  computeSlowRate,
  checkBadgeEligibility,
  resolveSessionScore,
  scoreNodeQuality
} from './nodeQualityScore'

describe('nodeQualityScore', () => {
  it('computeSlowRate counts delays above threshold', () => {
    assert.equal(computeSlowRate([100, 400, 600, 800], 500), 0.5)
    assert.equal(computeSlowRate([], 500), 0)
  })

  it('penalizes high slow500 rate more than stable tail', () => {
    const volatile = computeProbeMetrics(100, 99, [300, 320, 900, 950, 2800], [900, 950])
    const stable = computeProbeMetrics(100, 100, [430, 440, 450, 460, 470], [430, 440])
    assert.ok(volatile)
    assert.ok(stable)

    const volatileScore = scoreNodeQuality(volatile!)
    const stableScore = scoreNodeQuality(stable!)
    assert.ok(volatileScore.combinedScore < stableScore.combinedScore)
    assert.ok(volatileScore.slow500Penalty > stableScore.slow500Penalty)
  })

  it('does not apply estimated transport penalties without observations', () => {
    const probe = computeProbeMetrics(100, 100, [300, 310, 320], [300, 310])!
    const withoutSession = scoreNodeQuality(probe)
    const withEmptySession = scoreNodeQuality(probe, {
      transportFailures: 0
    })
    assert.equal(withoutSession.sessionScore, 0)
    assert.equal(withEmptySession.sessionScore, 0)
  })

  it('applies session penalties only from real observations', () => {
    const probe = computeProbeMetrics(100, 100, [300, 310, 320], [300, 310])!
    const scored = scoreNodeQuality(probe, {
      transportFailures: 3
    })
    assert.equal(scored.transportFailurePenalty, 6)
    assert.equal(scored.sessionScore, -6)
  })

  it('blocks badge when slow500 or jitter exceeds gate', () => {
    const ineligibleSlow = checkBadgeEligibility({
      samples: 100,
      successRate: BADGE_MIN_SUCCESS_RATE,
      slow500Rate: BADGE_MAX_SLOW500_RATE + 0.01,
      jitter: 50
    })
    assert.equal(ineligibleSlow.eligible, false)

    const ineligibleJitter = checkBadgeEligibility({
      samples: 100,
      successRate: BADGE_MIN_SUCCESS_RATE,
      slow500Rate: 0.05,
      jitter: BADGE_MAX_JITTER_MS + 1
    })
    assert.equal(ineligibleJitter.eligible, false)

    const eligible = checkBadgeEligibility({
      samples: 100,
      successRate: BADGE_MIN_SUCCESS_RATE,
      slow500Rate: 0.05,
      jitter: 100
    })
    assert.equal(eligible.eligible, true)
  })

  it('prefers 2h session score when recent observations exist', () => {
    const resolved = resolveSessionScore({
      full: {
        transportFailures: 5
      },
      recent: {
        transportFailures: 1
      }
    })
    assert.equal(resolved.sessionScoreSource, '2h')
    assert.equal(resolved.sessionScore, -2)
    assert.equal(resolved.sessionScore24h, -10)
    assert.ok(resolved.sessionScore24h < resolved.sessionScore)
  })

  it('falls back to 24h session score when 2h has no observations', () => {
    const resolved = resolveSessionScore({
      full: {
        transportFailures: 1
      },
      recent: {
        transportFailures: 0
      }
    })
    assert.equal(resolved.sessionScoreSource, '24h')
    assert.equal(resolved.sessionObservations2h, 0)
    assert.equal(resolved.sessionScore2h, null)
    assert.equal(resolved.sessionScore, resolved.sessionScore24h)
  })

  it('uses 2h session score in combined ranking when recent window is populated', () => {
    const probe = computeProbeMetrics(100, 100, [300, 310, 320], [300, 310])!
    const with24hOnly = scoreNodeQuality(probe, {
      full: {
        transportFailures: 4
      }
    })
    const with2hPreferred = scoreNodeQuality(probe, {
      full: {
        transportFailures: 4
      },
      recent: {
        transportFailures: 1
      }
    })
    assert.equal(with2hPreferred.sessionScoreSource, '2h')
    assert.ok(with2hPreferred.combinedScore > with24hOnly.combinedScore)
    assert.equal(with2hPreferred.sessionScore, -2)
  })

  it('recent slow spike adds recency penalty', () => {
    const probe = computeProbeMetrics(
      100,
      100,
      [300, 310, 320, 330, 340],
      [700, 800, 900]
    )!
    assert.ok(probe.slow500RateRecent > 0.25)
    const scored = scoreNodeQuality(probe)
    assert.ok(scored.recentSlowPenalty > 0)
  })

  it('disqualifies low success rate probes from ranking use', () => {
    const probe = computeProbeMetrics(100, 80, [300, 310], [300])!
    const scored = scoreNodeQuality(probe)
    assert.equal(scored.disqualified, true)
    assert.equal(scored.disqualifyReason, `success<${(0.9 * 100).toFixed(0)}%`)
  })

  it('JP-like volatile profile scores below KR-like stable profile', () => {
    const jpLikeDelays = Array.from({ length: 200 }, (_, index) =>
      index % 5 === 0 ? 800 + index * 3 : 280 + index
    )
    const krLikeDelays = Array.from({ length: 200 }, (_, index) => 430 + (index % 7))

    const jpProbe = computeProbeMetrics(288, 283, jpLikeDelays, jpLikeDelays.slice(-24))!
    const krProbe = computeProbeMetrics(288, 287, krLikeDelays, krLikeDelays.slice(-24))!

    const jpScore = scoreNodeQuality(jpProbe)
    const krScore = scoreNodeQuality(krProbe)
    assert.ok(jpScore.combinedScore < krScore.combinedScore)
    assert.equal(jpScore.eligibleForBadge, false)
  })
})
