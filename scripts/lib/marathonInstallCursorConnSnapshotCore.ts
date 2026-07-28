// [INPUT] none
// [OUTPUT] buildPreInstallCursorConnSnapshot · assertPostQuitInstallAllowed
// [POS] TIP-1 fail-closed: persist pre-quit cursor_conn + quiesce before mihomo teardown.

import { homedir } from 'node:os'
import { join } from 'node:path'

export const PRE_INSTALL_CURSOR_CONN_SNAPSHOT_RELATIVE_PATH = join(
  '.sparkle',
  'pre-install-cursor-conn.json',
)

export const PRE_INSTALL_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

export interface PreInstallCursorConnSnapshot {
  cursorConnectionCount: number
  quiesceActive: boolean
  blockColdRestart: boolean
  capturedAtMs: number
  caller: string
}

export interface MarathonGuardStateFilePayload {
  updatedAtMs?: number
  quiesceActive?: boolean
  cursorConnectionCount?: number
  blockColdRestart?: boolean
}

export function getPreInstallCursorConnSnapshotPath(
  homeDir: string = homedir(),
): string {
  return join(homeDir, PRE_INSTALL_CURSOR_CONN_SNAPSHOT_RELATIVE_PATH)
}

export function buildPreInstallCursorConnSnapshot(input: {
  cursorConnectionCount: number
  quiesceActive: boolean
  blockColdRestart: boolean
  caller: string
  capturedAtMs?: number
}): PreInstallCursorConnSnapshot {
  return {
    cursorConnectionCount: Math.max(0, Math.floor(input.cursorConnectionCount)),
    quiesceActive: input.quiesceActive,
    blockColdRestart: input.blockColdRestart,
    capturedAtMs: input.capturedAtMs ?? Date.now(),
    caller: input.caller.trim() || 'install',
  }
}

export function parsePreInstallCursorConnSnapshot(
  raw: unknown,
): PreInstallCursorConnSnapshot | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Record<string, unknown>
  const capturedAtMs = Number(record.capturedAtMs)
  const cursorConnectionCount = Number(record.cursorConnectionCount)
  if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) {
    return null
  }
  if (!Number.isFinite(cursorConnectionCount) || cursorConnectionCount < 0) {
    return null
  }
  return {
    cursorConnectionCount: Math.floor(cursorConnectionCount),
    quiesceActive: record.quiesceActive === true,
    blockColdRestart: record.blockColdRestart === true,
    capturedAtMs: Math.floor(capturedAtMs),
    caller: typeof record.caller === 'string' ? record.caller : 'install',
  }
}

export function assertPostQuitInstallAllowed(
  snapshot: PreInstallCursorConnSnapshot | null,
  nowMs: number = Date.now(),
): { allowed: boolean; reason: string } {
  if (!snapshot) {
    return {
      allowed: false,
      reason: 'missing_pre_quit_snapshot',
    }
  }
  if (nowMs - snapshot.capturedAtMs > PRE_INSTALL_SNAPSHOT_MAX_AGE_MS) {
    return {
      allowed: false,
      reason: 'stale_pre_quit_snapshot',
    }
  }
  if (snapshot.cursorConnectionCount > 0) {
    return {
      allowed: false,
      reason: `cursor_conn_active:${snapshot.cursorConnectionCount}`,
    }
  }
  if (snapshot.quiesceActive || snapshot.blockColdRestart) {
    return {
      allowed: false,
      reason: snapshot.quiesceActive
        ? 'marathon_quiesce_active'
        : 'marathon_block_cold_restart',
    }
  }
  return { allowed: true, reason: 'idle' }
}

export function readFreshMarathonGuardStatePayload(
  payload: MarathonGuardStateFilePayload | null,
  nowMs: number = Date.now(),
  maxAgeMs: number = 120_000,
): MarathonGuardStateFilePayload | null {
  if (!payload) {
    return null
  }
  const updatedAtMs = Number(payload.updatedAtMs ?? 0)
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return null
  }
  if (nowMs - updatedAtMs > maxAgeMs) {
    return null
  }
  return payload
}
