// [INPUT] none (pure marathon stream token-gap detection)
// [OUTPUT] parseRendererStreamActivityLine · detectMarathonStreamTokenGap
// [POS] Proactive HY2 nudge when Connect SSE goes silent but HTTP probes stay green.

import { parseLogField, parseLogNumber } from './agentTransportFailureWriterCore'
import {
  CURSOR_HY2_MARATHON_CONN_THRESHOLD,
  CURSOR_HY2_COLD_RESUME_LOOKBACK_MS,
  CURSOR_HY2_COLD_RESUME_NO_TOKEN_THRESHOLD_MS,
  CURSOR_HY2_TOKEN_GAP_FORCE_MS,
  CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS,
} from './cursorHy2MarathonKeepaliveCore'

export {
  CURSOR_HY2_TOKEN_GAP_FORCE_MS,
  CURSOR_HY2_TOKEN_GAP_MIN_INTERVAL_MS,
} from './cursorHy2MarathonKeepaliveCore'

const MEANINGFUL_SSE_MSG_CASES = new Set([
  'tokenDelta',
  'textDelta',
  'toolCallStarted',
  'toolCallCompleted',
  'toolCallDelta',
  'partialToolCall',
  'thinkingDelta',
  'thinkingCompleted',
  'stepCompleted',
  'stepStarted',
])

export interface StreamActivitySample {
  requestId: string
  activityMs: number
}

export interface MarathonStreamTokenGapSignal {
  maxGapMs: number
  staleRequestIds: string[]
  lookbackMs: number
  cursorConnectionCount: number
}

function parseSseAuditActivityLine(line: string): StreamActivitySample | undefined {
  if (!line.includes('[ifm-patch-19] SSE audit')) {
    return undefined
  }
  const msgCase = parseLogField(line, 'msgCase')
  if (!msgCase || !MEANINGFUL_SSE_MSG_CASES.has(msgCase)) {
    return undefined
  }
  const activityMs = parseLogNumber(line, 'ts')
  const requestId =
    parseLogField(line, 'txReqId') ||
    parseLogField(line, 'genUUID') ||
    parseLogField(line, 'chatGenUUID')
  if (activityMs <= 0 || !requestId) {
    return undefined
  }
  return { requestId, activityMs }
}

function parseIfmEventStreamActivityLine(line: string): StreamActivitySample | undefined {
  if (!line.includes('[ifm-event-v1]') || !line.includes('"eventKind":"stream_activity"')) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as {
      requestId?: string
      occurredAtMs?: number
      payload?: { activityKind?: string; activityMs?: number }
    }
    const activityKind = payload.payload?.activityKind ?? ''
    if (activityKind === 'heartbeat' || !activityKind) {
      return undefined
    }
    const requestId = String(payload.requestId ?? '').trim()
    const activityMs =
      typeof payload.payload?.activityMs === 'number'
        ? payload.payload.activityMs
        : typeof payload.occurredAtMs === 'number'
          ? payload.occurredAtMs
          : 0
    if (activityMs <= 0 || !requestId) {
      return undefined
    }
    return { requestId, activityMs }
  } catch {
    return undefined
  }
}

export function parseRendererStreamActivityLine(line: string): StreamActivitySample | undefined {
  return parseSseAuditActivityLine(line) ?? parseIfmEventStreamActivityLine(line)
}

const STRUCTURED_LOG_TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/

/** Cursor Structured Logs: composer warns when resume/stream has no inbound token by 32s. */
export function parseColdResumeNoFirstTokenLine(line: string): StreamActivitySample | undefined {
  if (!line.includes('No first token received within')) {
    return undefined
  }
  const jsonStart = line.indexOf('{')
  if (jsonStart < 0) {
    return undefined
  }
  try {
    const payload = JSON.parse(line.slice(jsonStart)) as {
      message?: string
      metadata?: { requestId?: string; thresholdMs?: string }
    }
    const thresholdMs = Number(payload.metadata?.thresholdMs ?? 0)
    const message = String(payload.message ?? '')
    const matchesThreshold =
      thresholdMs >= CURSOR_HY2_COLD_RESUME_NO_TOKEN_THRESHOLD_MS ||
      message === `No first token received within ${CURSOR_HY2_COLD_RESUME_NO_TOKEN_THRESHOLD_MS / 1000}s`
    if (!matchesThreshold) {
      return undefined
    }
    const requestId = String(payload.metadata?.requestId ?? '').trim()
    if (!requestId) {
      return undefined
    }
    const tsMatch = line.match(STRUCTURED_LOG_TS_RE)
    if (!tsMatch) {
      return undefined
    }
    const activityMs = Date.parse(tsMatch[1].replace(' ', 'T'))
    if (!Number.isFinite(activityMs) || activityMs <= 0) {
      return undefined
    }
    return { requestId, activityMs }
  } catch {
    return undefined
  }
}

function buildLatestActivityByRequestId(
  samples: readonly StreamActivitySample[],
  sinceMs: number,
  nowMs: number,
): Map<string, number> {
  const latestByRequestId = new Map<string, number>()
  for (const sample of samples) {
    if (sample.activityMs < sinceMs || sample.activityMs > nowMs + 2_000) {
      continue
    }
    const prev = latestByRequestId.get(sample.requestId) ?? 0
    if (sample.activityMs > prev) {
      latestByRequestId.set(sample.requestId, sample.activityMs)
    }
  }
  return latestByRequestId
}

/** Cold resume streams that never received meaningful SSE — token_gap cannot see them. */
export function detectMarathonColdResumeNoToken(
  coldResumeSamples: readonly StreamActivitySample[],
  activitySamples: readonly StreamActivitySample[],
  options: {
    nowMs: number
    cursorConnectionCount: number
    lookbackMs?: number
    marathonConnThreshold?: number
  },
): MarathonStreamTokenGapSignal | undefined {
  const lookbackMs = options.lookbackMs ?? CURSOR_HY2_COLD_RESUME_LOOKBACK_MS
  const marathonConnThreshold = options.marathonConnThreshold ?? CURSOR_HY2_MARATHON_CONN_THRESHOLD

  if (options.cursorConnectionCount < marathonConnThreshold) {
    return undefined
  }
  if (coldResumeSamples.length === 0) {
    return undefined
  }

  const sinceMs = options.nowMs - lookbackMs
  const meaningfulActivity = buildLatestActivityByRequestId(
    activitySamples,
    sinceMs,
    options.nowMs,
  )

  const latestColdByRequestId = new Map<string, number>()
  for (const sample of coldResumeSamples) {
    if (sample.activityMs < sinceMs || sample.activityMs > options.nowMs + 2_000) {
      continue
    }
    const prev = latestColdByRequestId.get(sample.requestId) ?? 0
    if (sample.activityMs > prev) {
      latestColdByRequestId.set(sample.requestId, sample.activityMs)
    }
  }

  const staleRequestIds: string[] = []
  let maxGapMs = 0

  for (const [requestId, coldSeenAtMs] of latestColdByRequestId) {
    const lastMeaningfulMs = meaningfulActivity.get(requestId) ?? 0
    if (lastMeaningfulMs >= coldSeenAtMs) {
      continue
    }
    const gapMs = Math.max(0, options.nowMs - coldSeenAtMs)
    staleRequestIds.push(requestId)
    maxGapMs = Math.max(maxGapMs, gapMs)
  }

  if (staleRequestIds.length === 0) {
    return undefined
  }

  staleRequestIds.sort()

  return {
    maxGapMs,
    staleRequestIds,
    lookbackMs,
    cursorConnectionCount: options.cursorConnectionCount,
  }
}

/** Detect marathon Connect streams with prolonged token silence (split-brain precursor). */
export function detectMarathonStreamTokenGap(
  samples: readonly StreamActivitySample[],
  options: {
    nowMs: number
    cursorConnectionCount: number
    minGapMs?: number
    lookbackMs?: number
    marathonConnThreshold?: number
  },
): MarathonStreamTokenGapSignal | undefined {
  const minGapMs = options.minGapMs ?? CURSOR_HY2_TOKEN_GAP_FORCE_MS
  const lookbackMs = options.lookbackMs ?? CURSOR_HY2_TOKEN_GAP_LOOKBACK_MS
  const marathonConnThreshold = options.marathonConnThreshold ?? CURSOR_HY2_MARATHON_CONN_THRESHOLD

  if (options.cursorConnectionCount < marathonConnThreshold) {
    return undefined
  }

  const sinceMs = options.nowMs - lookbackMs
  const latestByRequestId = buildLatestActivityByRequestId(samples, sinceMs, options.nowMs)

  if (latestByRequestId.size === 0) {
    return undefined
  }

  const staleRequestIds: string[] = []
  let maxGapMs = 0

  for (const [requestId, activityMs] of latestByRequestId) {
    const gapMs = Math.max(0, options.nowMs - activityMs)
    if (gapMs >= minGapMs) {
      staleRequestIds.push(requestId)
      maxGapMs = Math.max(maxGapMs, gapMs)
    }
  }

  if (staleRequestIds.length === 0) {
    return undefined
  }

  staleRequestIds.sort()

  return {
    maxGapMs,
    staleRequestIds,
    lookbackMs,
    cursorConnectionCount: options.cursorConnectionCount,
  }
}
