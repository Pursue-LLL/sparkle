// [INPUT] quicStallSsotCore · fs atomic write
// [OUTPUT] writeQuicStallSsotSnapshot
// [POS] P22b atom writer — ~/.sparkle/quic-stall-ssot.json for Guard patch-315 execute.

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  buildQuicStallSsotSnapshot,
  quicStallSsotPath,
  serializeQuicStallSsotSnapshot,
  type QuicStallSsotSnapshot,
} from './quicStallSsotCore'

export async function writeQuicStallSsotSnapshot(input: {
  maxStallMs: number
  frozenQuicCursorCount: number
  cursorConnectionCount: number
  nowMs: number
}): Promise<QuicStallSsotSnapshot> {
  const snapshot = buildQuicStallSsotSnapshot({
    maxStallMs: input.maxStallMs,
    frozenQuicCursorCount: input.frozenQuicCursorCount,
    cursorConnectionCount: input.cursorConnectionCount,
    updatedAtMs: input.nowMs,
  })
  const path = quicStallSsotPath()
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, serializeQuicStallSsotSnapshot(snapshot), 'utf8')
  const { rename } = await import('fs/promises')
  await rename(tmpPath, path)
  return snapshot
}
