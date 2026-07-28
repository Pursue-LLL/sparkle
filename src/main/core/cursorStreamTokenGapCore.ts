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
  /** P14c: marathon silent EOF with gap < token_gap threshold — force Connect-path rescue. */
  suddenSilentGenerationEnd?: boolean
}

/** P14c: sudden generation-ended-without-turnEnded on long marathon turns. */
export const CURSOR_SILENT_GENERATION_END_MIN_DURATION_MS = 1_800_000
export const CURSOR_SILENT_GENERATION_END_MAX_GAP_MS = 30_000
export const CURSOR_SILENT_GENERATION_END_LOOKBACK_MS = 120_000

export interface SilentGenerationEndSample {
  requestId: string
  originalRequestId: string
  terminalMs: number
  durationMs: number
  gapSinceActivityMs: number
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
  const txReqId = parseLogField(line, 'txReqId')
  const genUuid = parseLogField(line, 'genUUID') || parseLogField(line, 'chatGenUUID')
  const requestId = txReqId || genUuid
  if (activityMs <= 0 || !requestId) {
    return undefined
  }
  return { requestId, activityMs }
}

/** P14d: index both segment txReqId and marathon originalRequestId for rescue stale_rids. */
export function expandStreamActivitySampleAliases(
  sample: StreamActivitySample,
  line: string,
): StreamActivitySample[] {
  if (!line.includes('[ifm-patch-19] SSE audit')) {
    return [sample]
  }
  const ids = new Set<string>([sample.requestId])
  for (const field of ['txReqId', 'genUUID', 'chatGenUUID'] as const) {
    const value = parseLogField(line, field)
    if (value) {
      ids.add(value)
    }
  }
  return [...ids].map((requestId) => ({ requestId, activityMs: sample.activityMs }))
}

export function parseSilentGenerationEndLine(line: string): SilentGenerationEndSample | undefined {
  if (!line.includes('[ifm-event-v1]') || !line.includes('"eventKind":"stream_terminated"')) {
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
      occurredAtMs?: number
      payload?: {
        reason?: string
        terminalMs?: number
        durationMs?: number
        gapSinceActivityMs?: number
      }
    }
    const nested = payload.payload ?? {}
    const reason = String(nested.reason ?? '')
    if (reason !== 'generation-ended-without-turnEnded') {
      return undefined
    }
    const durationMs = typeof nested.durationMs === 'number' ? nested.durationMs : 0
    const gapSinceActivityMs =
      typeof nested.gapSinceActivityMs === 'number' ? nested.gapSinceActivityMs : 0
    const terminalMs =
      typeof nested.terminalMs === 'number'
        ? nested.terminalMs
        : typeof payload.occurredAtMs === 'number'
          ? payload.occurredAtMs
          : 0
    const requestId = String(payload.requestId ?? '').trim()
    const originalRequestId =
      String(payload.originalRequestId ?? payload.requestId ?? '').trim() || requestId
    if (terminalMs <= 0 || !requestId) {
      return undefined
    }
    return {
      requestId,
      originalRequestId,
      terminalMs,
      durationMs,
      gapSinceActivityMs,
    }
  } catch {
    return undefined
  }
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

/** P14c: recent marathon silent EOF — rescue even when token gap < 20s. */
export function detectMarathonSilentGenerationEndRescue(
  samples: readonly SilentGenerationEndSample[],
  options: {
    nowMs: number
    cursorConnectionCount: number
    lookbackMs?: number
    marathonConnThreshold?: number
    minDurationMs?: number
    maxGapMs?: number
  },
): MarathonStreamTokenGapSignal | undefined {
  const lookbackMs = options.lookbackMs ?? CURSOR_SILENT_GENERATION_END_LOOKBACK_MS
  const marathonConnThreshold = options.marathonConnThreshold ?? CURSOR_HY2_MARATHON_CONN_THRESHOLD
  const minDurationMs = options.minDurationMs ?? CURSOR_SILENT_GENERATION_END_MIN_DURATION_MS
  const maxGapMs = options.maxGapMs ?? CURSOR_SILENT_GENERATION_END_MAX_GAP_MS

  if (options.cursorConnectionCount < marathonConnThreshold) {
    return undefined
  }

  const sinceMs = options.nowMs - lookbackMs
  const staleRequestIds: string[] = []
  let latestTerminalMs = 0
  let latestGapMs = 0

  for (const sample of samples) {
    if (sample.terminalMs < sinceMs || sample.terminalMs > options.nowMs + 2_000) {
      continue
    }
    if (sample.durationMs < minDurationMs) {
      continue
    }
    if (sample.gapSinceActivityMs >= maxGapMs) {
      continue
    }
    staleRequestIds.push(sample.requestId)
    if (sample.originalRequestId !== sample.requestId) {
      staleRequestIds.push(sample.originalRequestId)
    }
    if (sample.terminalMs >= latestTerminalMs) {
      latestTerminalMs = sample.terminalMs
      latestGapMs = sample.gapSinceActivityMs
    }
  }

  if (staleRequestIds.length === 0) {
    return undefined
  }

  const uniqueStaleIds = [...new Set(staleRequestIds)].sort()

  return {
    maxGapMs: Math.max(latestGapMs, 1),
    staleRequestIds: uniqueStaleIds,
    lookbackMs,
    cursorConnectionCount: options.cursorConnectionCount,
    suddenSilentGenerationEnd: true,
  }
}
