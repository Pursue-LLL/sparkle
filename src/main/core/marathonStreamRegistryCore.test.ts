import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMarathonStreamRegistry,
  isTokenGapSuppressedForPendingTool,
  parseStreamToolActivityLine,
} from './marathonStreamRegistryCore'

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
})
