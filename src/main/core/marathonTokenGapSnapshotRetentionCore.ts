// [INPUT] fresh token gap signal · marathon truth · prior retained snapshot
// [OUTPUT] resolveMarathonTokenGapRecoverySnapshot
// [POS] R-34e — avoid zeroing prune gate proof between hung_scan ticks during marathon.

/** Align with token_gap lookback + ineffective emit cooldown (120–180s). */
export const MARATHON_TOKEN_GAP_SNAPSHOT_RETENTION_MS = 180_000

export interface MarathonTokenGapRecoverySnapshot {
  maxGapMs: number
  staleRequestIdCount: number
}

export type MarathonTokenGapRecoverySnapshotSource = 'fresh' | 'retained' | 'cleared'

export interface MarathonTokenGapRecoverySnapshotResolution {
  snapshot: MarathonTokenGapRecoverySnapshot
  retainedAtMs: number
  source: MarathonTokenGapRecoverySnapshotSource
}

function hasStaleTokenGapProof(snapshot: MarathonTokenGapRecoverySnapshot): boolean {
  return snapshot.staleRequestIdCount > 0 && snapshot.maxGapMs > 0
}

export function resolveMarathonTokenGapRecoverySnapshot(input: {
  fresh: MarathonTokenGapRecoverySnapshot | null
  marathonTruthActive: boolean
  retained: MarathonTokenGapRecoverySnapshot
  retainedAtMs: number
  nowMs: number
}): MarathonTokenGapRecoverySnapshotResolution {
  if (input.fresh != null) {
    if (hasStaleTokenGapProof(input.fresh)) {
      return {
        snapshot: {
          maxGapMs: Math.max(0, input.fresh.maxGapMs),
          staleRequestIdCount: Math.max(0, input.fresh.staleRequestIdCount),
        },
        retainedAtMs: input.nowMs,
        source: 'fresh',
      }
    }
    return {
      snapshot: { maxGapMs: 0, staleRequestIdCount: 0 },
      retainedAtMs: 0,
      source: 'cleared',
    }
  }

  if (
    input.marathonTruthActive &&
    input.retainedAtMs > 0 &&
    hasStaleTokenGapProof(input.retained) &&
    input.nowMs - input.retainedAtMs <= MARATHON_TOKEN_GAP_SNAPSHOT_RETENTION_MS
  ) {
    return {
      snapshot: input.retained,
      retainedAtMs: input.retainedAtMs,
      source: 'retained',
    }
  }

  return {
    snapshot: { maxGapMs: 0, staleRequestIdCount: 0 },
    retainedAtMs: 0,
    source: 'cleared',
  }
}
