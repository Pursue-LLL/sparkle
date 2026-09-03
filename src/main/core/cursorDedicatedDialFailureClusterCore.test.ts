import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyCursorDedicatedDialFailureLine,
  CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT,
  CURSOR_DIAL_FAILURE_CLUSTER_WINDOW_MS,
  isCursorDedicatedDialFailureCluster,
  pruneCursorDedicatedDialFailureEvents,
} from './cursorDedicatedDialFailureClusterCore'

describe('cursorDedicatedDialFailureClusterCore @1.30.54', () => {
  it('classifies context deadline exceeded on Cursor dedicated', () => {
    const line =
      'time="2026-09-03T15:13:33.862231000+08:00" level=warning msg="[TCP] dial 🎯 Cursor 专用 (...) --> api2.cursor.sh:443 error: context deadline exceeded"'
    const event = classifyCursorDedicatedDialFailureLine(line)
    assert.equal(event?.kind, 'context_deadline_exceeded')
  })

  it('classifies tcp i/o timeout on Cursor dedicated', () => {
    const line =
      'time="2026-09-03T14:41:21.890084000+08:00" level=warning msg="[TCP] dial 🎯 Cursor 专用 (...) error: 45.76.104.78:443 connect error: dial tcp 45.76.104.78:443: i/o timeout"'
    const event = classifyCursorDedicatedDialFailureLine(line)
    assert.equal(event?.kind, 'tcp_io_timeout')
  })

  it('detects cluster when >=5 failures in 10s window', () => {
    const nowMs = 1_000_000
    const events = Array.from({ length: CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT }, (_, i) => ({
      tsMs: nowMs - i * 500,
      kind: 'context_deadline_exceeded' as const,
      line: `failure-${i}`,
    }))
    const pruned = pruneCursorDedicatedDialFailureEvents(events, nowMs)
    assert.equal(pruned.length, CURSOR_DIAL_FAILURE_CLUSTER_MIN_COUNT)
    assert.equal(
      isCursorDedicatedDialFailureCluster({ events: pruned }),
      true,
    )
  })

  it('prunes events outside window', () => {
    const nowMs = 1_000_000
    const events = [
      { tsMs: nowMs - CURSOR_DIAL_FAILURE_CLUSTER_WINDOW_MS - 1, kind: 'other' as const, line: 'old' },
      { tsMs: nowMs - 1_000, kind: 'other' as const, line: 'fresh' },
    ]
    const pruned = pruneCursorDedicatedDialFailureEvents(events, nowMs)
    assert.equal(pruned.length, 1)
    assert.equal(pruned[0]?.line, 'fresh')
  })
})
