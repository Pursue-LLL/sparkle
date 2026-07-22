// [INPUT] agentTransportFailureSync log discovery · cursorStreamTokenGapCore
// [OUTPUT] readMarathonStreamTokenGapSignal · readConnectStreamKeepaliveGapSignal
// [POS] hung_scan: renderer tail → token-gap signal for proactive HY2 + Connect stream keepalive.

import {
  detectMarathonStreamTokenGap,
  detectMarathonColdResumeNoToken,
  parseColdResumeNoFirstTokenLine,
  parseRendererStreamActivityLine,
  type MarathonStreamTokenGapSignal,
  type StreamActivitySample,
} from './cursorStreamTokenGapCore'
import { CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS } from './cursorConnectStreamKeepaliveCore'
import {
  listCursorStructuredLogFiles,
  listRendererLogFiles,
  readLogFileTail,
  resolveCursorDataDirs,
} from './agentTransportFailureSync'

const RENDERER_ACTIVITY_TAIL_BYTES = 512_000
const STRUCTURED_LOG_TAIL_BYTES = 512_000

async function collectRendererActivitySamples(_nowMs: number): Promise<StreamActivitySample[]> {
  const samples: StreamActivitySample[] = []
  for (const cursorDataDir of await resolveCursorDataDirs()) {
    for (const filePath of await listRendererLogFiles(cursorDataDir)) {
      if (!/renderer(\.\d+)?\.log$/.test(filePath)) {
        continue
      }
      const text = await readLogFileTail(filePath, RENDERER_ACTIVITY_TAIL_BYTES)
      for (const line of text.split('\n')) {
        const sample = parseRendererStreamActivityLine(line)
        if (sample) {
          samples.push(sample)
        }
      }
    }
  }
  return samples
}

async function collectColdResumeSamples(_nowMs: number): Promise<StreamActivitySample[]> {
  const samples: StreamActivitySample[] = []
  for (const cursorDataDir of await resolveCursorDataDirs()) {
    for (const filePath of await listCursorStructuredLogFiles(cursorDataDir)) {
      const text = await readLogFileTail(filePath, STRUCTURED_LOG_TAIL_BYTES)
      for (const line of text.split('\n')) {
        const sample = parseColdResumeNoFirstTokenLine(line)
        if (sample) {
          samples.push(sample)
        }
      }
    }
  }
  return samples
}

export async function readMarathonStreamTokenGapSignal(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<MarathonStreamTokenGapSignal | undefined> {
  const samples = await collectRendererActivitySamples(nowMs)
  return detectMarathonStreamTokenGap(samples, {
    nowMs,
    cursorConnectionCount,
  })
}

/** Earlier gap threshold (15s) for Connect long-stream keepalive before 20s ETIMEDOUT window. */
export async function readConnectStreamKeepaliveGapSignal(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<MarathonStreamTokenGapSignal | undefined> {
  const samples = await collectRendererActivitySamples(nowMs)
  return detectMarathonStreamTokenGap(samples, {
    nowMs,
    cursorConnectionCount,
    minGapMs: CURSOR_CONNECT_STREAM_KEEPALIVE_GAP_MS,
  })
}

export async function readMarathonColdResumeNoTokenSignal(
  cursorConnectionCount: number,
  nowMs: number = Date.now(),
): Promise<MarathonStreamTokenGapSignal | undefined> {
  const [activitySamples, coldResumeSamples] = await Promise.all([
    collectRendererActivitySamples(nowMs),
    collectColdResumeSamples(nowMs),
  ])
  return detectMarathonColdResumeNoToken(coldResumeSamples, activitySamples, {
    nowMs,
    cursorConnectionCount,
  })
}
