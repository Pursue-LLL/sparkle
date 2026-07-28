// [INPUT] api2ProbeLedgerRowCore::Api2ProbeLedgerRow (POS: api2 探针 ledger 行 SSOT)
// [OUTPUT] excludeSessionNudgeSamplesFromProviderHistory · readSessionNudgeAnchorsFromLedger
// [POS] P9n 纯函数：从 provider history 柱图剔除 session_transport_nudge 样本，避免误判 VPS 健康度。

export interface ProviderDelayHistorySample {
  time: string
  delay: number
}

export interface SessionNudgeDelayAnchor {
  sampledAtMs: number
  delayMs: number
}

/** Match ledger nudge ts to mihomo history entry time (clock skew + queue delay). */
export const SESSION_NUDGE_HISTORY_MATCH_WINDOW_MS = 2_500

/** Allow small rounding difference between ledger latency_ms and history delay. */
export const SESSION_NUDGE_HISTORY_DELAY_TOLERANCE_MS = 80

export function readSessionNudgeAnchorsFromLedger(
  raw: string,
  sinceMs: number,
  nodeName: string,
): SessionNudgeDelayAnchor[] {
  const anchors: SessionNudgeDelayAnchor[] = []
  const normalizedNode = nodeName.trim()
  if (!normalizedNode) {
    return anchors
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    try {
      const row = JSON.parse(line) as {
        ts?: string
        node?: string
        method?: string
        latency_ms?: number
        ok?: boolean
      }
      if (row.method !== 'session_nudge' || row.ok !== true) {
        continue
      }
      if (row.node !== normalizedNode) {
        continue
      }
      const sampledAtMs = Date.parse(row.ts ?? '')
      if (!Number.isFinite(sampledAtMs) || sampledAtMs < sinceMs) {
        continue
      }
      const delayMs =
        typeof row.latency_ms === 'number' && row.latency_ms > 0 ? row.latency_ms : 0
      if (delayMs <= 0) {
        continue
      }
      anchors.push({ sampledAtMs, delayMs })
    } catch {
      continue
    }
  }

  return anchors
}

export function matchesSessionNudgeHistorySample(
  entry: ProviderDelayHistorySample,
  anchor: SessionNudgeDelayAnchor,
  matchWindowMs: number = SESSION_NUDGE_HISTORY_MATCH_WINDOW_MS,
  delayToleranceMs: number = SESSION_NUDGE_HISTORY_DELAY_TOLERANCE_MS,
): boolean {
  const sampledAtMs = Date.parse(entry.time)
  if (!Number.isFinite(sampledAtMs) || entry.delay <= 0) {
    return false
  }
  if (Math.abs(sampledAtMs - anchor.sampledAtMs) > matchWindowMs) {
    return false
  }
  return Math.abs(entry.delay - anchor.delayMs) <= delayToleranceMs
}

/** Only hide nudge spikes on the bar chart — baseline nudge RTT (~300ms) stays visible during quiesce. */
export const SESSION_NUDGE_CHART_EXCLUDE_MIN_DELAY_MS = 500

export function excludeSessionNudgeSamplesFromProviderHistory<
  T extends ProviderDelayHistorySample,
>(
  history: readonly T[],
  anchors: readonly SessionNudgeDelayAnchor[],
  excludeMinDelayMs: number = SESSION_NUDGE_CHART_EXCLUDE_MIN_DELAY_MS,
): T[] {
  if (history.length === 0 || anchors.length === 0) {
    return [...history]
  }
  const spikeAnchors = anchors.filter((anchor) => anchor.delayMs >= excludeMinDelayMs)
  if (spikeAnchors.length === 0) {
    return [...history]
  }
  return history.filter(
    (entry) =>
      !spikeAnchors.some((anchor) => matchesSessionNudgeHistorySample(entry, anchor)),
  )
}
