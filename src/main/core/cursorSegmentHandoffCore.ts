// [INPUT] marathonStreamRegistryCore · cursorHy2MarathonKeepaliveCore thresholds
// [OUTPUT] parseHttpSegmentStartedLine · detectSegmentHandoffDue
// [POS] P22 segment-age detection @ ~85min before L7 silent EOF cap.

import { CURSOR_HY2_MARATHON_CONN_THRESHOLD } from './cursorHy2MarathonKeepaliveCore'
import type { MarathonStreamRegistry } from './marathonStreamRegistryCore'

/** Proactive handoff target: ~85min before observed ~89–91min L7 silent EOF. */
export const CURSOR_SEGMENT_HANDOFF_TARGET_MS = 5_100_000

/** Require meaningful stream activity within this window to prove segment is still healthy. */
export const CURSOR_SEGMENT_HANDOFF_MAX_LAST_ACTIVITY_GAP_MS = 120_000

export interface HttpSegmentStartedSample {
  segmentId: string
  requestId: string
  originalRequestId: string
  composerId: string
  actionCase: string
  httpStartMs: number
}

export interface SegmentHandoffDueSignal {
  segmentId: string
  requestId: string
  originalRequestId: string
  composerId: string
  actionCase: string
  segmentAgeMs: number
  pendingToolCalls: number
  lastActivityMs: number
  lastActivityGapMs: number
}

export function parseHttpSegmentStartedLine(line: string): HttpSegmentStartedSample | undefined {
  if (!line.includes('[ifm-event-v1]') || !line.includes('"eventKind":"http_segment_started"')) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as {
      requestId?: string
      originalRequestId?: string
      composerId?: string
      actionCase?: string
      payload?: { segmentId?: string; httpStartMs?: number }
    }
    const nested = payload.payload ?? {}
    const segmentId = String(nested.segmentId ?? '').trim()
    const httpStartMs = typeof nested.httpStartMs === 'number' ? nested.httpStartMs : 0
    const requestId = String(payload.requestId ?? '').trim()
    const originalRequestId =
      String(payload.originalRequestId ?? payload.requestId ?? '').trim() || requestId
    const composerId = String(payload.composerId ?? '').trim()
    const actionCase = String(payload.actionCase ?? '').trim()
    if (!segmentId || httpStartMs <= 0 || !requestId) {
      return undefined
    }
    return {
      segmentId,
      requestId,
      originalRequestId,
      composerId,
      actionCase,
      httpStartMs,
    }
  } catch {
    return undefined
  }
}

export function parseSegmentTerminatedId(line: string): string | undefined {
  if (!line.includes('[ifm-event-v1]') || !line.includes('"eventKind":"stream_terminated"')) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as {
      segmentId?: string
      payload?: { segmentId?: string }
    }
    const segmentId = String(payload.payload?.segmentId ?? payload.segmentId ?? '').trim()
    return segmentId || undefined
  } catch {
    return undefined
  }
}

function resolveRegistryRecord(
  registry: MarathonStreamRegistry,
  requestId: string,
  originalRequestId: string,
): { requestId: string; lastActivityMs: number; openToolCalls: number } | undefined {
  const direct = registry.records.get(requestId)
  if (direct) {
    return direct
  }
  for (const record of registry.records.values()) {
    if (record.originalRequestId === originalRequestId || record.requestId === originalRequestId) {
      return record
    }
  }
  return undefined
}

/** Detect resumeAction segment ready for proactive handoff before L7 silent EOF. */
export function detectSegmentHandoffDue(
  segments: readonly HttpSegmentStartedSample[],
  terminatedSegmentIds: ReadonlySet<string>,
  registry: MarathonStreamRegistry,
  options: {
    nowMs: number
    cursorConnectionCount: number
    targetAgeMs?: number
    maxLastActivityGapMs?: number
    marathonConnThreshold?: number
  },
): SegmentHandoffDueSignal | undefined {
  const targetAgeMs = options.targetAgeMs ?? CURSOR_SEGMENT_HANDOFF_TARGET_MS
  const maxLastActivityGapMs =
    options.maxLastActivityGapMs ?? CURSOR_SEGMENT_HANDOFF_MAX_LAST_ACTIVITY_GAP_MS
  const marathonConnThreshold = options.marathonConnThreshold ?? CURSOR_HY2_MARATHON_CONN_THRESHOLD

  if (options.cursorConnectionCount < marathonConnThreshold) {
    return undefined
  }
  if (segments.length === 0) {
    return undefined
  }

  const latestBySegmentId = new Map<string, HttpSegmentStartedSample>()
  for (const segment of segments) {
    const prev = latestBySegmentId.get(segment.segmentId)
    if (!prev || segment.httpStartMs >= prev.httpStartMs) {
      latestBySegmentId.set(segment.segmentId, segment)
    }
  }

  let best: SegmentHandoffDueSignal | undefined

  for (const segment of latestBySegmentId.values()) {
    if (terminatedSegmentIds.has(segment.segmentId)) {
      continue
    }
    const segmentAgeMs = Math.max(0, options.nowMs - segment.httpStartMs)
    if (segmentAgeMs < targetAgeMs) {
      continue
    }

    const record = resolveRegistryRecord(registry, segment.requestId, segment.originalRequestId)
    if (!record) {
      continue
    }
    if (record.openToolCalls > 0) {
      continue
    }

    const lastActivityGapMs = Math.max(0, options.nowMs - record.lastActivityMs)
    if (lastActivityGapMs > maxLastActivityGapMs) {
      continue
    }

    const signal: SegmentHandoffDueSignal = {
      segmentId: segment.segmentId,
      requestId: segment.requestId,
      originalRequestId: segment.originalRequestId,
      composerId: segment.composerId,
      actionCase: segment.actionCase,
      segmentAgeMs,
      pendingToolCalls: record.openToolCalls,
      lastActivityMs: record.lastActivityMs,
      lastActivityGapMs,
    }

    if (!best || signal.segmentAgeMs > best.segmentAgeMs) {
      best = signal
    }
  }

  return best
}
