// [INPUT] StreamActivitySample · SilentGenerationEndSample patterns · cursorHy2MarathonKeepaliveCore
// [OUTPUT] buildMarathonStreamRegistry · isTokenGapSuppressedForPendingTool
// [POS] §22 MTDO: active marathon RID registry from renderer/IFM tail (read-only).

import type { StreamActivitySample } from './cursorStreamTokenGapCore'
import {
  CURSOR_HY2_PENDING_TOOL_GAP_SUPPRESS_MAX_MS,
  CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS,
} from './cursorHy2MarathonKeepaliveCore'

export interface MarathonStreamRecord {
  requestId: string
  originalRequestId: string
  firstActivityMs: number
  lastActivityMs: number
  openToolCalls: number
}

export interface MarathonStreamRegistry {
  records: ReadonlyMap<string, MarathonStreamRecord>
}

/** P25: registry scan window — must cover marathon tool pauses (not MTDO active-stream gap). */
export const MARATHON_STREAM_REGISTRY_LOOKBACK_MS = CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS

const TOOL_START_CASES = new Set(['toolCallStarted', 'partialToolCall'])
const TOOL_END_CASES = new Set(['toolCallCompleted'])

export function parseStreamToolActivityLine(line: string): {
  requestId: string
  originalRequestId: string
  activityMs: number
  msgCase: string
} | undefined {
  if (!line.includes('[ifm-patch-19] SSE audit')) {
    return undefined
  }
  const msgCaseMatch = line.match(/msgCase=([A-Za-z]+)/)
  const msgCase = msgCaseMatch?.[1] ?? ''
  if (!msgCase) {
    return undefined
  }
  const tsMatch = line.match(/(?:^|\s)ts=(\d+)/)
  const activityMs = tsMatch ? Number(tsMatch[1]) : 0
  const txReqIdMatch = line.match(/txReqId=([^\s]+)/)
  const genMatch = line.match(/(?:genUUID|chatGenUUID)=([^\s]+)/)
  const requestId = txReqIdMatch?.[1] ?? genMatch?.[1] ?? ''
  const originalRequestId = genMatch?.[1] ?? txReqIdMatch?.[1] ?? requestId
  if (activityMs <= 0 || !requestId) {
    return undefined
  }
  return { requestId, originalRequestId, activityMs, msgCase }
}

function resolveOriginalRequestId(requestId: string, originalRequestId?: string): string {
  return originalRequestId?.trim() || requestId
}

function upsertMarathonStreamRecord(
  records: Map<string, MarathonStreamRecord>,
  requestId: string,
  originalRequestId: string,
  activityMs: number,
): void {
  const resolvedOriginal = resolveOriginalRequestId(requestId, originalRequestId)
  const prev = records.get(requestId)
  if (!prev) {
    records.set(requestId, {
      requestId,
      originalRequestId: resolvedOriginal,
      firstActivityMs: activityMs,
      lastActivityMs: activityMs,
      openToolCalls: 0,
    })
    return
  }
  records.set(requestId, {
    ...prev,
    originalRequestId: prev.originalRequestId || resolvedOriginal,
    firstActivityMs: Math.min(prev.firstActivityMs, activityMs),
    lastActivityMs: Math.max(prev.lastActivityMs, activityMs),
  })
}

export function buildMarathonStreamRegistry(
  activitySamples: readonly StreamActivitySample[],
  toolLines: readonly string[],
  nowMs: number,
  lookbackMs: number = MARATHON_STREAM_REGISTRY_LOOKBACK_MS,
): MarathonStreamRegistry {
  const sinceMs = nowMs - lookbackMs
  const records = new Map<string, MarathonStreamRecord>()

  for (const sample of activitySamples) {
    if (sample.activityMs < sinceMs || sample.activityMs > nowMs + 2_000) {
      continue
    }
    upsertMarathonStreamRecord(records, sample.requestId, sample.requestId, sample.activityMs)
  }

  for (const line of toolLines) {
    const toolActivity = parseStreamToolActivityLine(line)
    if (!toolActivity || toolActivity.activityMs < sinceMs) {
      continue
    }
    upsertMarathonStreamRecord(
      records,
      toolActivity.requestId,
      toolActivity.originalRequestId,
      toolActivity.activityMs,
    )
    const prev = records.get(toolActivity.requestId)
    if (!prev) {
      continue
    }
    let openToolCalls = prev.openToolCalls
    if (TOOL_START_CASES.has(toolActivity.msgCase)) {
      openToolCalls += 1
    } else if (TOOL_END_CASES.has(toolActivity.msgCase)) {
      openToolCalls = Math.max(0, openToolCalls - 1)
    }
    records.set(toolActivity.requestId, {
      ...prev,
      lastActivityMs: Math.max(prev.lastActivityMs, toolActivity.activityMs),
      openToolCalls,
    })
  }

  return { records }
}

export function isTokenGapSuppressedForPendingTool(
  registry: MarathonStreamRegistry,
  staleRequestIds: readonly string[],
  maxGapMs: number = 0,
): boolean {
  if (maxGapMs >= CURSOR_HY2_PENDING_TOOL_GAP_SUPPRESS_MAX_MS) {
    return false
  }
  for (const requestId of staleRequestIds) {
    const record = registry.records.get(requestId)
    if (record && record.openToolCalls > 0) {
      return true
    }
    for (const entry of registry.records.values()) {
      if (
        entry.openToolCalls > 0 &&
        (entry.requestId === requestId || entry.originalRequestId === requestId)
      ) {
        return true
      }
    }
  }
  return false
}

export function hasActiveMarathonStream(
  registry: MarathonStreamRegistry,
  nowMs: number,
  options: {
    minStreamAgeMs: number
    maxLastActivityGapMs: number
  },
): boolean {
  for (const record of registry.records.values()) {
    const streamAgeMs = nowMs - record.firstActivityMs
    const lastGapMs = nowMs - record.lastActivityMs
    if (streamAgeMs < options.minStreamAgeMs) {
      continue
    }
    if (record.openToolCalls > 0) {
      return true
    }
    if (lastGapMs <= options.maxLastActivityGapMs) {
      return true
    }
  }
  return false
}
