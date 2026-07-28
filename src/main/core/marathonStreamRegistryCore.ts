// [INPUT] StreamActivitySample · SilentGenerationEndSample patterns
// [OUTPUT] buildMarathonStreamRegistry · isTokenGapSuppressedForPendingTool
// [POS] §22 MTDO: active marathon RID registry from renderer/IFM tail (read-only).

import type { StreamActivitySample } from './cursorStreamTokenGapCore'

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

const TOOL_START_CASES = new Set(['toolCallStarted', 'partialToolCall'])
const TOOL_END_CASES = new Set(['toolCallCompleted'])

export function parseStreamToolActivityLine(line: string): {
  requestId: string
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
  if (activityMs <= 0 || !requestId) {
    return undefined
  }
  return { requestId, activityMs, msgCase }
}

export function buildMarathonStreamRegistry(
  activitySamples: readonly StreamActivitySample[],
  toolLines: readonly string[],
  nowMs: number,
  lookbackMs: number,
): MarathonStreamRegistry {
  const sinceMs = nowMs - lookbackMs
  const records = new Map<string, MarathonStreamRecord>()

  for (const sample of activitySamples) {
    if (sample.activityMs < sinceMs || sample.activityMs > nowMs + 2_000) {
      continue
    }
    const prev = records.get(sample.requestId)
    if (!prev) {
      records.set(sample.requestId, {
        requestId: sample.requestId,
        originalRequestId: sample.requestId,
        firstActivityMs: sample.activityMs,
        lastActivityMs: sample.activityMs,
        openToolCalls: 0,
      })
      continue
    }
    records.set(sample.requestId, {
      ...prev,
      firstActivityMs: Math.min(prev.firstActivityMs, sample.activityMs),
      lastActivityMs: Math.max(prev.lastActivityMs, sample.activityMs),
    })
  }

  for (const line of toolLines) {
    const toolActivity = parseStreamToolActivityLine(line)
    if (!toolActivity || toolActivity.activityMs < sinceMs) {
      continue
    }
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
): boolean {
  for (const requestId of staleRequestIds) {
    const record = registry.records.get(requestId)
    if (record && record.openToolCalls > 0) {
      return true
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
    if (streamAgeMs >= options.minStreamAgeMs && lastGapMs <= options.maxLastActivityGapMs) {
      return true
    }
  }
  return false
}
