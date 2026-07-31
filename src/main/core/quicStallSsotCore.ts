// [INPUT] cursorSegmentHandoffCore thresholds (POS: P22 segment-age / QUIC stall handoff constants)
// [OUTPUT] parseQuicStallSsotJson · buildEffectiveHandoffTargetMsFromSsot · quicStallSsotPath
// [POS] Cross-process QUIC stall SSOT for Sparkle detect and Guard patch-315 execute.

import { homedir } from 'os'
import { join } from 'path'
import {
  CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS,
  CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS,
  CURSOR_SEGMENT_HANDOFF_TARGET_MS,
  resolveEffectiveHandoffTargetMs,
  type SegmentHandoffQuicStallContext,
} from './cursorSegmentHandoffCore'

export const QUIC_STALL_SSOT_FILENAME = 'quic-stall-ssot.json'
export const QUIC_STALL_SSOT_SCHEMA_VERSION = 1
export const QUIC_STALL_SSOT_MAX_AGE_MS = 120_000

export interface QuicStallSsotSnapshot {
  schemaVersion: number
  maxStallMs: number
  frozenQuicCursorCount: number
  cursorConnectionCount: number
  updatedAtMs: number
}

export function quicStallSsotPath(): string {
  return join(homedir(), '.sparkle', QUIC_STALL_SSOT_FILENAME)
}

export function buildQuicStallSsotSnapshot(input: {
  maxStallMs: number
  frozenQuicCursorCount: number
  cursorConnectionCount: number
  updatedAtMs: number
}): QuicStallSsotSnapshot {
  return {
    schemaVersion: QUIC_STALL_SSOT_SCHEMA_VERSION,
    maxStallMs: Math.max(0, Math.round(input.maxStallMs)),
    frozenQuicCursorCount: Math.max(0, Math.round(input.frozenQuicCursorCount)),
    cursorConnectionCount: Math.max(0, Math.round(input.cursorConnectionCount)),
    updatedAtMs: Math.max(0, Math.round(input.updatedAtMs)),
  }
}

export function parseQuicStallSsotJson(text: string): QuicStallSsotSnapshot | undefined {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    const row = JSON.parse(trimmed) as Partial<QuicStallSsotSnapshot>
    if (typeof row.updatedAtMs !== 'number' || row.updatedAtMs <= 0) {
      return undefined
    }
    return buildQuicStallSsotSnapshot({
      maxStallMs: typeof row.maxStallMs === 'number' ? row.maxStallMs : 0,
      frozenQuicCursorCount:
        typeof row.frozenQuicCursorCount === 'number' ? row.frozenQuicCursorCount : 0,
      cursorConnectionCount:
        typeof row.cursorConnectionCount === 'number' ? row.cursorConnectionCount : 0,
      updatedAtMs: row.updatedAtMs,
    })
  } catch {
    return undefined
  }
}

export function serializeQuicStallSsotSnapshot(snapshot: QuicStallSsotSnapshot): string {
  return `${JSON.stringify(snapshot)}\n`
}

export function toSegmentHandoffQuicStallContext(
  snapshot: QuicStallSsotSnapshot,
): SegmentHandoffQuicStallContext {
  return {
    maxStallMs: snapshot.maxStallMs,
    frozenQuicCursorCount: snapshot.frozenQuicCursorCount,
  }
}

export function buildEffectiveHandoffTargetMsFromSsot(
  snapshot: QuicStallSsotSnapshot | undefined,
  targetAgeMs: number = CURSOR_SEGMENT_HANDOFF_TARGET_MS,
): number {
  if (!snapshot) {
    return targetAgeMs
  }
  return resolveEffectiveHandoffTargetMs(targetAgeMs, toSegmentHandoffQuicStallContext(snapshot))
}

export function isQuicStallSsotStale(
  snapshot: QuicStallSsotSnapshot,
  nowMs: number,
  maxAgeMs: number = QUIC_STALL_SSOT_MAX_AGE_MS,
): boolean {
  return nowMs - snapshot.updatedAtMs > maxAgeMs
}

export function isQuicStallSsotFresh(
  snapshot: QuicStallSsotSnapshot | undefined,
  nowMs: number,
  maxAgeMs: number = QUIC_STALL_SSOT_MAX_AGE_MS,
): snapshot is QuicStallSsotSnapshot {
  if (!snapshot) {
    return false
  }
  return !isQuicStallSsotStale(snapshot, nowMs, maxAgeMs)
}

export function resolveHandoffTriggerFromSsot(
  segmentAgeMs: number,
  snapshot: QuicStallSsotSnapshot | undefined,
  targetAgeMs: number = CURSOR_SEGMENT_HANDOFF_TARGET_MS,
): 'age' | 'quic_stall' {
  if (!snapshot) {
    return 'age'
  }
  const ctx = toSegmentHandoffQuicStallContext(snapshot)
  if (
    ctx.frozenQuicCursorCount >= 1 &&
    ctx.maxStallMs >= CURSOR_SEGMENT_HANDOFF_QUIC_STALL_FORCE_MS &&
    segmentAgeMs >= CURSOR_SEGMENT_HANDOFF_QUIC_STALL_MIN_SEGMENT_MS &&
    segmentAgeMs < targetAgeMs
  ) {
    return 'quic_stall'
  }
  return 'age'
}
