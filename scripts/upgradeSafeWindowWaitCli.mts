#!/usr/bin/env -S node --import tsx
/** Poll marathon guard state until upgrade safe window is idle, or timeout. */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  formatUpgradeSafeWindowIdleReason,
  isUpgradeBreakGlassEnabled,
  isUpgradeSafeWindowIdle,
  type UpgradeSafeWindowSnapshot,
} from './upgradeSafeWindowCore'

const GUARD_STATE_FILE = join(homedir(), '.sparkle', 'marathon-core-restart-guard.json')
const POLL_INTERVAL_SEC = 30

function readGuardSnapshot(): UpgradeSafeWindowSnapshot {
  if (!existsSync(GUARD_STATE_FILE)) {
    return {
      cursorConnectionCount: -1,
      quiesceActive: false,
      blockColdRestart: false,
      recentActiveLifecycleStreamCount: 0,
      observationAvailable: false,
    }
  }
  try {
    const payload = JSON.parse(readFileSync(GUARD_STATE_FILE, 'utf8')) as Record<string, unknown>
    const cursorConnectionCount = Number(payload.cursorConnectionCount ?? -1)
    return {
      cursorConnectionCount: Number.isFinite(cursorConnectionCount)
        ? Math.floor(cursorConnectionCount)
        : -1,
      quiesceActive: payload.quiesceActive === true,
      blockColdRestart: payload.blockColdRestart === true,
      recentActiveLifecycleStreamCount: Math.max(
        0,
        Math.floor(Number(payload.recentActiveLifecycleStreamCount ?? 0)),
      ),
      observationAvailable: Number.isFinite(cursorConnectionCount),
    }
  } catch {
    return {
      cursorConnectionCount: -1,
      quiesceActive: false,
      blockColdRestart: false,
      recentActiveLifecycleStreamCount: 0,
      observationAvailable: false,
    }
  }
}

async function main(): Promise<void> {
  if (isUpgradeBreakGlassEnabled()) {
    console.error('[UpgradeSafeWindow] break_glass=1 skip_idle_wait')
    return
  }

  const maxWaitSec = Number(process.env.SPARKLE_UPGRADE_IDLE_WAIT_SEC ?? 30 * 60)
  const deadlineMs = Date.now() + maxWaitSec * 1000

  while (Date.now() < deadlineMs) {
    const snapshot = readGuardSnapshot()
    if (isUpgradeSafeWindowIdle(snapshot)) {
      console.error('[UpgradeSafeWindow] idle=1 reason=safe_window_ready')
      return
    }
    const remainingSec = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000))
    console.error(
      `[UpgradeSafeWindow] idle=0 reason=${formatUpgradeSafeWindowIdleReason(snapshot)} remaining_sec=${remainingSec}`,
    )
    await delay(POLL_INTERVAL_SEC * 1000)
  }

  console.error(
    `[UpgradeSafeWindow] FAIL: safe window not idle within ${maxWaitSec}s — set SPARKLE_UPGRADE_BREAK_GLASS=1 only as last resort`,
  )
  process.exit(1)
}

void main()
