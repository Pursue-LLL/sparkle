// [INPUT] marathon segment cache · renderer ifm tail · stream registry
// [OUTPUT] resolveMarathonSSETruthNow
// [POS] P24 runtime adapter shared by MTDO and MarathonDialTolerance.

import type { HttpSegmentStartedSample } from './cursorSegmentHandoffCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'
import {
  buildMarathonStreamRegistry,
  MARATHON_STREAM_REGISTRY_LOOKBACK_MS,
} from './marathonStreamRegistryCore'
import type { StreamActivitySample } from './cursorStreamTokenGapCore'
import {
  collectRendererActivitySamplesForMtdo,
  collectRendererIfmSegmentLinesForMtdo,
  collectRendererToolAuditLinesForMtdo,
} from './marathonTransportDialReader'
import {
  appendMarathonSegmentCache,
  mergeMarathonSegmentRecords,
  readMarathonSegmentCache,
} from './marathonSegmentCache'
import {
  collectSegmentsFromIfmLines,
  evaluateMarathonSSETruth,
  type MarathonSSETruthResult,
} from './marathonSSETruthCore'
import type { MarathonSegmentCacheRecord } from './marathonSegmentCache'

export interface MarathonSSETruthBuildInput {
  nowMs: number
  cursorConnectionCount: number
  lastConnectPathPulseAtMs: number
  activitySamples: readonly StreamActivitySample[]
  toolLines: readonly string[]
  ifmSegmentLines: readonly string[]
  cacheRecords: readonly MarathonSegmentCacheRecord[]
}

export function buildMarathonSSETruthSnapshotFromParts(
  input: MarathonSSETruthBuildInput,
): { truth: MarathonSSETruthResult; registry: MarathonStreamRegistry; mergedSegments: HttpSegmentStartedSample[] } {
  const registry = buildMarathonStreamRegistry(
    input.activitySamples,
    input.toolLines,
    input.nowMs,
    MARATHON_STREAM_REGISTRY_LOOKBACK_MS,
  )
  const { segments: tailSegments, terminatedSegmentIds } =
    collectSegmentsFromIfmLines(input.ifmSegmentLines)
  const mergedSegments = mergeMarathonSegmentRecords(input.cacheRecords, tailSegments)
  const truth = evaluateMarathonSSETruth({
    nowMs: input.nowMs,
    cursorConnectionCount: input.cursorConnectionCount,
    segments: mergedSegments,
    terminatedSegmentIds,
    registry,
    lastConnectPathPulseAtMs: input.lastConnectPathPulseAtMs,
  })
  return { truth, registry, mergedSegments }
}

export async function resolveMarathonSSETruthNow(
  cursorConnectionCount: number,
  lastConnectPathPulseAtMs: number = 0,
): Promise<MarathonSSETruthResult> {
  const snapshot = await resolveMarathonSSETruthSnapshot(cursorConnectionCount, lastConnectPathPulseAtMs)
  return snapshot.truth
}

export async function resolveMarathonSSETruthSnapshot(
  cursorConnectionCount: number,
  lastConnectPathPulseAtMs: number = 0,
): Promise<{ truth: MarathonSSETruthResult; registry: MarathonStreamRegistry }> {
  const nowMs = Date.now()
  const [activitySamples, toolLines, ifmSegmentLines] = await Promise.all([
    collectRendererActivitySamplesForMtdo(nowMs),
    collectRendererToolAuditLinesForMtdo(nowMs),
    collectRendererIfmSegmentLinesForMtdo(nowMs),
  ])
  const { segments: tailSegments } = collectSegmentsFromIfmLines(ifmSegmentLines)
  const cacheRecords = await readMarathonSegmentCache(nowMs)
  const knownSegmentIds = new Set(cacheRecords.map((record) => record.segmentId))
  void appendMarathonSegmentCache(tailSegments, knownSegmentIds, nowMs)
  const built = buildMarathonSSETruthSnapshotFromParts({
    nowMs,
    cursorConnectionCount,
    lastConnectPathPulseAtMs,
    activitySamples,
    toolLines,
    ifmSegmentLines,
    cacheRecords,
  })
  return { truth: built.truth, registry: built.registry }
}
