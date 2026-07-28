import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMarathonStreamRegistry,
  hasActiveMarathonStream,
  isTokenGapSuppressedForPendingTool,
  parseStreamToolActivityLine,
} from './marathonStreamRegistryCore'
import { CURSOR_HY2_PENDING_TOOL_GAP_SUPPRESS_MAX_MS } from './cursorHy2MarathonKeepaliveCore'

describe('marathonStreamRegistryCore', () => {
  it('tracks open tool calls from SSE audit lines', () => {
    const startLine =
      '2026-07-25 14:51:00.000 [info] [ifm-patch-19] SSE audit msgCase=toolCallStarted ts=1000 txReqId=rid-1'
    const endLine =
      '2026-07-25 14:51:30.000 [info] [ifm-patch-19] SSE audit msgCase=toolCallCompleted ts=2000 txReqId=rid-1'
    const parsed = parseStreamToolActivityLine(startLine)
    assert.ok(parsed)
    assert.equal(parsed?.msgCase, 'toolCallStarted')

    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'rid-1', activityMs: 2000 }],
      [startLine],
      3000,
      5000,
    )
    assert.equal(isTokenGapSuppressedForPendingTool(registry, ['rid-1']), true)

    const completedRegistry = buildMarathonStreamRegistry(
      [{ requestId: 'rid-1', activityMs: 2000 }],
      [startLine, endLine],
      3000,
      5000,
    )
    assert.equal(isTokenGapSuppressedForPendingTool(completedRegistry, ['rid-1']), false)
  })

  it('does not suppress token_gap when pending tool gap exceeds 60s (P25)', () => {
    const nowMs = 700_000
    const lastActivityMs = nowMs - 30_000
    const startLine =
      `2026-07-28 17:31:00.000 [info] [ifm-patch-19] SSE audit msgCase=toolCallStarted ts=${lastActivityMs} txReqId=seg-1 genUUID=orig-rid`
    const registry = buildMarathonStreamRegistry(
      [{ requestId: 'orig-rid', activityMs: lastActivityMs }],
      [startLine],
      nowMs,
      120_000,
    )
    assert.equal(
      isTokenGapSuppressedForPendingTool(
        registry,
        ['orig-rid'],
        CURSOR_HY2_PENDING_TOOL_GAP_SUPPRESS_MAX_MS + 1_000,
      ),
      false,
    )
    assert.equal(
      isTokenGapSuppressedForPendingTool(registry, ['orig-rid'], 30_000),
      true,
    )
  })

  it('treats marathon stream with pending tool as active despite long gap (P25)', () => {
    const startLine =
      '2026-07-28 17:31:00.000 [info] [ifm-patch-19] SSE audit msgCase=toolCallStarted ts=1000 txReqId=seg-1 genUUID=orig-rid'
    const agedRegistry = buildMarathonStreamRegistry(
      [{ requestId: 'orig-rid', activityMs: 100 }],
      [startLine.replace('ts=1000', 'ts=100')],
      2_000_000,
      3_000_000,
    )
    assert.equal(
      hasActiveMarathonStream(agedRegistry, 2_000_000, {
        minStreamAgeMs: 1_800_000,
        maxLastActivityGapMs: 120_000,
      }),
      true,
    )
  })
})
