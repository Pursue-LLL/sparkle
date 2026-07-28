// [INPUT] agentTransportFailureSync log discovery · cursorStreamTokenGapCore
// [OUTPUT] collectRendererActivitySamplesForMtdo · collectRendererToolAuditLinesForMtdo
// [POS] §22 MTDO reader helpers (renderer tail for registry + tool audit).

import {
  expandStreamActivitySampleAliases,
  parseRendererStreamActivityLine,
  type StreamActivitySample,
} from './cursorStreamTokenGapCore'
import {
  listRendererLogFiles,
  readLogFileTail,
  resolveCursorDataDirs,
} from './agentTransportFailureSync'

const RENDERER_TAIL_BYTES = 512_000

export async function collectRendererActivitySamplesForMtdo(
  _nowMs: number,
): Promise<StreamActivitySample[]> {
  const samples: StreamActivitySample[] = []
  for (const cursorDataDir of await resolveCursorDataDirs()) {
    for (const filePath of await listRendererLogFiles(cursorDataDir)) {
      if (!/renderer(\.\d+)?\.log$/.test(filePath)) {
        continue
      }
      const text = await readLogFileTail(filePath, RENDERER_TAIL_BYTES)
      for (const line of text.split('\n')) {
        const sample = parseRendererStreamActivityLine(line)
        if (sample) {
          samples.push(...expandStreamActivitySampleAliases(sample, line))
        }
      }
    }
  }
  return samples
}

export async function collectRendererToolAuditLinesForMtdo(_nowMs: number): Promise<string[]> {
  const lines: string[] = []
  for (const cursorDataDir of await resolveCursorDataDirs()) {
    for (const filePath of await listRendererLogFiles(cursorDataDir)) {
      if (!/renderer(\.\d+)?\.log$/.test(filePath)) {
        continue
      }
      const text = await readLogFileTail(filePath, RENDERER_TAIL_BYTES)
      for (const line of text.split('\n')) {
        if (line.includes('[ifm-patch-19] SSE audit') && /msgCase=(toolCallStarted|toolCallCompleted|partialToolCall)/.test(line)) {
          lines.push(line)
        }
      }
    }
  }
  return lines
}
