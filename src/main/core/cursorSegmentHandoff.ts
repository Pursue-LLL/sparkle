// [INPUT] cursorSegmentHandoffCore · marathonTransportDialReader · appendAppLog
// [OUTPUT] evaluateAndLogSegmentHandoffDue
// [POS] P22 hung_scan 观测层 — logs [SegmentHandoff] outcome=due phase=detect_only；execute 由 Guard312 c2-wb-025。

import { appendAppLog } from '../utils/log'
import {
  listRendererLogFiles,
  readLogFileTail,
  resolveCursorDataDirs,
} from './agentTransportFailureSync'
import {
  CURSOR_SEGMENT_HANDOFF_TARGET_MS,
  detectSegmentHandoffDue,
  parseHttpSegmentStartedLine,
  parseSegmentTerminatedId,
} from './cursorSegmentHandoffCore'
import { buildMarathonStreamRegistry } from './marathonStreamRegistryCore'
import {
  collectRendererActivitySamplesForMtdo,
  collectRendererToolAuditLinesForMtdo,
} from './marathonTransportDialReader'

const RENDERER_TAIL_BYTES = 768_000
const HANDOFF_LOG_COOLDOWN_MS = 600_000
const HANDOFF_REGISTRY_LOOKBACK_MS = 6 * 60 * 60_000

let lastHandoffLogAtBySegmentId = new Map<string, number>()

export function resetSegmentHandoffLogStateForTests(): void {
  lastHandoffLogAtBySegmentId = new Map()
}

async function collectRendererIfmEventLines(): Promise<string[]> {
  const lines: string[] = []
  for (const cursorDataDir of await resolveCursorDataDirs()) {
    for (const filePath of await listRendererLogFiles(cursorDataDir)) {
      if (!/renderer(\.\d+)?\.log$/.test(filePath)) {
        continue
      }
      const text = await readLogFileTail(filePath, RENDERER_TAIL_BYTES)
      for (const line of text.split('\n')) {
        if (line.includes('[ifm-event-v1]')) {
          lines.push(line)
        }
      }
    }
  }
  return lines
}

export async function evaluateAndLogSegmentHandoffDue(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const ifmLines = await collectRendererIfmEventLines()
  const segments = ifmLines
    .map(parseHttpSegmentStartedLine)
    .filter((sample): sample is NonNullable<typeof sample> => sample != null)
  const terminatedSegmentIds = new Set<string>()
  for (const line of ifmLines) {
    const segmentId = parseSegmentTerminatedId(line)
    if (segmentId) {
      terminatedSegmentIds.add(segmentId)
    }
  }

  const [activitySamples, toolLines] = await Promise.all([
    collectRendererActivitySamplesForMtdo(nowMs),
    collectRendererToolAuditLinesForMtdo(nowMs),
  ])
  const registry = buildMarathonStreamRegistry(
    activitySamples,
    toolLines,
    nowMs,
    HANDOFF_REGISTRY_LOOKBACK_MS,
  )

  const due = detectSegmentHandoffDue(segments, terminatedSegmentIds, registry, {
    nowMs,
    cursorConnectionCount,
  })
  if (!due) {
    return
  }

  const lastLoggedAt = lastHandoffLogAtBySegmentId.get(due.segmentId) ?? 0
  if (nowMs - lastLoggedAt < HANDOFF_LOG_COOLDOWN_MS) {
    return
  }
  lastHandoffLogAtBySegmentId.set(due.segmentId, nowMs)

  const targetMin = Math.round(CURSOR_SEGMENT_HANDOFF_TARGET_MS / 60_000)
  await appendAppLog(
    `[SegmentHandoff]: outcome=due phase=detect_only segmentId=${due.segmentId}` +
      ` requestId=${due.requestId} originalRequestId=${due.originalRequestId}` +
      ` actionCase=${due.actionCase || 'unknown'} segmentAgeMs=${due.segmentAgeMs}` +
      ` targetMin=${targetMin} pendingTool=${due.pendingToolCalls}` +
      ` lastActivityGapMs=${due.lastActivityGapMs} cursor_conn=${cursorConnectionCount}\n`,
  )
}
