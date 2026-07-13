/** Pure Cursor node quality scoring — probe layer (all nodes) + session layer (observed only). */

export const CURSOR_PROBE_SLOW_MS = 500
export const SLOW500_PENALTY_WEIGHT = 30
export const JITTER_PENALTY_WEIGHT = 0.05
export const AVG_PENALTY_DIVISOR = 100
export const RECENT_SLOW_WINDOW_MS = 2 * 60 * 60 * 1000
export const RECENT_SESSION_WINDOW_MS = RECENT_SLOW_WINDOW_MS
export const RECENT_SLOW_RATE_GATE = 0.25
export const RECENT_SLOW_EXTRA_PENALTY_WEIGHT = 20
export const MIN_RECENT_SESSION_OBSERVATIONS = 1

export const MIN_RANK_SAMPLES = 10
export const DISQUALIFY_SUCCESS_RATE = 0.9
export const BADGE_MIN_SUCCESS_RATE = 0.95
export const BADGE_MAX_SLOW500_RATE = 0.15
export const BADGE_MAX_JITTER_MS = 150

export const SESSION_RST_PENALTY = 2

export interface NodeTransportObservations {
  transportFailures: number
}

export interface ProbeMetrics {
  samples: number
  successes: number
  successRate: number
  avg: number
  p50: number
  p90: number
  p95: number
  min: number
  max: number
  jitter: number
  slow500Rate: number
  slow500RateRecent: number
  cv: number
}

export interface SessionTransportWindow {
  full?: NodeTransportObservations
  recent?: NodeTransportObservations
}

export interface SessionScoreResolution {
  sessionScore: number
  sessionScore24h: number
  sessionScore2h: number | null
  sessionScoreSource: '2h' | '24h'
  sessionObservations2h: number
  transportFailurePenalty: number
}

export interface QualityScoreBreakdown {
  probeScore: number
  sessionScore: number
  sessionScore24h: number
  sessionScore2h: number | null
  sessionScoreSource: '2h' | '24h'
  sessionObservations2h: number
  combinedScore: number
  slow500Penalty: number
  jitterPenalty: number
  recentSlowPenalty: number
  transportFailurePenalty: number
  eligibleForBadge: boolean
  badgeBlockReason?: string
  disqualified: boolean
  disqualifyReason?: string
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return -1
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

export function avgDelay(delays: number[]): number {
  if (delays.length === 0) return -1
  return delays.reduce((sum, value) => sum + value, 0) / delays.length
}

export function computeSlowRate(delays: number[], thresholdMs: number): number {
  if (delays.length === 0) return 0
  const slowCount = delays.filter((delay) => delay > thresholdMs).length
  return slowCount / delays.length
}

export function computeProbeMetrics(
  samples: number,
  successes: number,
  delays: number[],
  recentDelays: number[]
): ProbeMetrics | null {
  if (delays.length === 0) return null
  const successRate = samples > 0 ? successes / samples : 0
  const avg = avgDelay(delays)
  const p50 = percentile(delays, 50)
  const p90 = percentile(delays, 90)
  const p95 = percentile(delays, 95)
  const min = Math.min(...delays)
  const max = Math.max(...delays)
  const jitter = p95 >= 0 && p50 >= 0 ? p95 - p50 : -1
  const slow500Rate = computeSlowRate(delays, CURSOR_PROBE_SLOW_MS)
  const slow500RateRecent = computeSlowRate(recentDelays, CURSOR_PROBE_SLOW_MS)
  const stdev =
    delays.length > 1
      ? Math.sqrt(delays.reduce((sum, value) => sum + (value - avg) ** 2, 0) / delays.length)
      : 0
  const cv = avg > 0 ? (stdev / avg) * 100 : -1
  return {
    samples,
    successes,
    successRate,
    avg,
    p50,
    p90,
    p95,
    min,
    max,
    jitter,
    slow500Rate,
    slow500RateRecent,
    cv
  }
}

export function checkBadgeEligibility(metrics: {
  samples: number
  successRate: number
  slow500Rate: number
  jitter: number
  minSamples?: number
}): { eligible: boolean; reason?: string } {
  const minSamples = metrics.minSamples ?? MIN_RANK_SAMPLES
  if (metrics.samples < minSamples) {
    return { eligible: false, reason: `samples<${minSamples}` }
  }
  if (metrics.successRate < BADGE_MIN_SUCCESS_RATE) {
    return {
      eligible: false,
      reason: `success<${(BADGE_MIN_SUCCESS_RATE * 100).toFixed(0)}%`
    }
  }
  if (metrics.slow500Rate > BADGE_MAX_SLOW500_RATE) {
    return {
      eligible: false,
      reason: `slow>${CURSOR_PROBE_SLOW_MS}ms>${(BADGE_MAX_SLOW500_RATE * 100).toFixed(0)}%`
    }
  }
  if (metrics.jitter >= 0 && metrics.jitter > BADGE_MAX_JITTER_MS) {
    return {
      eligible: false,
      reason: `jitter>${BADGE_MAX_JITTER_MS}ms`
    }
  }
  return { eligible: true }
}

export function countSessionObservations(transport: NodeTransportObservations): number {
  return transport.transportFailures
}

export interface SessionScoreComponents {
  sessionScore: number
  transportFailurePenalty: number
}

export function computeSessionScore(transport: NodeTransportObservations): SessionScoreComponents {
  const transportFailurePenalty = transport.transportFailures * SESSION_RST_PENALTY
  const sessionScore =
    transport.transportFailures === 0 ? 0 : -transportFailurePenalty
  return {
    sessionScore,
    transportFailurePenalty
  }
}

export function resolveSessionScore(windows: SessionTransportWindow): SessionScoreResolution {
  const empty: SessionScoreResolution = {
    sessionScore: 0,
    sessionScore24h: 0,
    sessionScore2h: null,
    sessionScoreSource: '24h',
    sessionObservations2h: 0,
    transportFailurePenalty: 0
  }

  const fullScore = windows.full ? computeSessionScore(windows.full) : null
  const sessionScore24h = fullScore?.sessionScore ?? 0
  const obs2h = windows.recent ? countSessionObservations(windows.recent) : 0
  const recentScore =
    windows.recent && obs2h > 0 ? computeSessionScore(windows.recent) : null
  const sessionScore2h = recentScore?.sessionScore ?? null

  if (
    recentScore &&
    obs2h >= MIN_RECENT_SESSION_OBSERVATIONS
  ) {
    return {
      ...recentScore,
      sessionScore: recentScore.sessionScore,
      sessionScore24h,
      sessionScore2h,
      sessionScoreSource: '2h',
      sessionObservations2h: obs2h
    }
  }

  if (fullScore) {
    return {
      ...fullScore,
      sessionScore: sessionScore24h,
      sessionScore24h,
      sessionScore2h,
      sessionScoreSource: '24h',
      sessionObservations2h: obs2h
    }
  }

  return {
    ...empty,
    sessionScore24h,
    sessionScore2h,
    sessionObservations2h: obs2h
  }
}

function isSessionTransportWindow(
  transport: NodeTransportObservations | SessionTransportWindow
): transport is SessionTransportWindow {
  return 'full' in transport || 'recent' in transport
}

export function scoreNodeQuality(
  probe: ProbeMetrics,
  transport?: NodeTransportObservations | SessionTransportWindow
): QualityScoreBreakdown {
  const disqualified = probe.successRate < DISQUALIFY_SUCCESS_RATE
  const slow500Penalty = probe.slow500Rate * SLOW500_PENALTY_WEIGHT
  const jitterPenalty = probe.jitter >= 0 ? probe.jitter * JITTER_PENALTY_WEIGHT : 0
  const recentSlowPenalty =
    probe.slow500RateRecent > RECENT_SLOW_RATE_GATE
      ? (probe.slow500RateRecent - RECENT_SLOW_RATE_GATE) * RECENT_SLOW_EXTRA_PENALTY_WEIGHT
      : 0

  const probeScore =
    probe.successRate * 100 -
    probe.avg / AVG_PENALTY_DIVISOR -
    slow500Penalty -
    jitterPenalty -
    recentSlowPenalty

  const sessionResolution = transport
    ? resolveSessionScore(
        isSessionTransportWindow(transport)
          ? transport
          : { full: transport }
      )
    : resolveSessionScore({})

  const {
    sessionScore,
    sessionScore24h,
    sessionScore2h,
    sessionScoreSource,
    sessionObservations2h,
    transportFailurePenalty
  } = sessionResolution

  const combinedScore = probeScore + sessionScore
  const badge = checkBadgeEligibility({
    samples: probe.samples,
    successRate: probe.successRate,
    slow500Rate: probe.slow500Rate,
    jitter: probe.jitter
  })

  return {
    probeScore,
    sessionScore,
    sessionScore24h,
    sessionScore2h,
    sessionScoreSource,
    sessionObservations2h,
    combinedScore,
    slow500Penalty,
    jitterPenalty,
    recentSlowPenalty,
    transportFailurePenalty,
    eligibleForBadge: badge.eligible,
    badgeBlockReason: badge.reason,
    disqualified,
    disqualifyReason: disqualified
      ? `success<${(DISQUALIFY_SUCCESS_RATE * 100).toFixed(0)}%`
      : undefined
  }
}
