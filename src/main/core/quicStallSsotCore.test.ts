import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS,
  CURSOR_SEGMENT_HANDOFF_TARGET_MS,
} from './cursorSegmentHandoffCore'
import {
  buildEffectiveHandoffTargetMsFromSsot,
  buildQuicStallSsotSnapshot,
  parseQuicStallSsotJson,
  isQuicStallSsotFresh,
  isQuicStallSsotStale,
  QUIC_STALL_SSOT_MAX_AGE_MS,
  resolveHandoffTriggerFromSsot,
  serializeQuicStallSsotSnapshot,
} from './quicStallSsotCore'

describe('quicStallSsotCore', () => {
  it('round-trips ssot json', () => {
    const snapshot = buildQuicStallSsotSnapshot({
      maxStallMs: 210_011,
      frozenQuicCursorCount: 2,
      cursorConnectionCount: 34,
      updatedAtMs: 1_700_000_000_000,
    })
    const parsed = parseQuicStallSsotJson(serializeQuicStallSsotSnapshot(snapshot))
    assert.deepEqual(parsed, snapshot)
  })

  it('lowers effective handoff target when quic stall is active', () => {
    const snapshot = buildQuicStallSsotSnapshot({
      maxStallMs: 95_000,
      frozenQuicCursorCount: 1,
      cursorConnectionCount: 12,
      updatedAtMs: Date.now(),
    })
    assert.equal(
      buildEffectiveHandoffTargetMsFromSsot(snapshot),
      CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS,
    )
  })

  it('resolves quic_stall trigger before age target', () => {
    const snapshot = buildQuicStallSsotSnapshot({
      maxStallMs: 120_000,
      frozenQuicCursorCount: 1,
      cursorConnectionCount: 20,
      updatedAtMs: Date.now(),
    })
    const segmentAgeMs = CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS + 60_000
    assert.equal(
      resolveHandoffTriggerFromSsot(segmentAgeMs, snapshot),
      'quic_stall',
    )
    assert.ok(segmentAgeMs < CURSOR_SEGMENT_HANDOFF_TARGET_MS)
  })

  it('treats stale ssot as not fresh', () => {
    const snapshot = buildQuicStallSsotSnapshot({
      maxStallMs: 120_000,
      frozenQuicCursorCount: 1,
      cursorConnectionCount: 20,
      updatedAtMs: Date.now() - QUIC_STALL_SSOT_MAX_AGE_MS - 1,
    })
    assert.equal(isQuicStallSsotStale(snapshot, Date.now()), true)
    assert.equal(isQuicStallSsotFresh(snapshot, Date.now()), false)
  })
})
