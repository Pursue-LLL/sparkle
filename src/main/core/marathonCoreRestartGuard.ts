// [INPUT] marathonCoreRestartGuardCore · marathonQuiesce · cursorConnectionHygiene · fs
// [OUTPUT] Runtime guard evaluation + ~/.sparkle/marathon-core-restart-guard.json
// [POS] Blocks in-process stopCore/restartCore during marathon; shell scripts read state file.

import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { appendAppLog } from '../utils/log'
import { countCursorConnections } from './cursorConnectionHygiene'
import { getMarathonQuiesceSnapshot } from './marathonQuiesce'
import {
  buildMarathonCoreRestartGuardStateFilePayload,
  formatCoreLifecycleBlockedLog,
  formatCoreLifecycleScheduledLog,
  isMarathonCoreRestartForceOverride,
  shouldBlockMarathonCoreColdRestart,
  type CoreLifecycleCaller,
  type MarathonCoreRestartGuardSnapshot,
} from './marathonCoreRestartGuardCore'

const GUARD_STATE_RELATIVE_PATH = join('.sparkle', 'marathon-core-restart-guard.json')

export function getMarathonCoreRestartGuardStateFilePath(): string {
  return join(homedir(), GUARD_STATE_RELATIVE_PATH)
}

export async function readMarathonCoreRestartGuardSnapshot(
  nowMs: number = Date.now(),
): Promise<MarathonCoreRestartGuardSnapshot> {
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const cursorConnectionCount = await countCursorConnections().catch(() => 0)
  let recentMarathonUserMessageCount = 0
  try {
    const { readMarathonSegmentCache } = await import('./marathonSegmentCache')
    const { countRecentMarathonUserMessageSegments } = await import(
      './marathonCoreRestartGuardSegmentsCore'
    )
    const records = await readMarathonSegmentCache(nowMs)
    recentMarathonUserMessageCount = countRecentMarathonUserMessageSegments({
      records,
      nowMs,
    })
  } catch {
    recentMarathonUserMessageCount = 0
  }
  return {
    quiesceActive: quiesceSnapshot.active,
    cursorConnectionCount,
    recentMarathonUserMessageCount,
    updatedAtMs: nowMs,
  }
}

export async function refreshMarathonCoreRestartGuardStateFile(
  snapshot?: MarathonCoreRestartGuardSnapshot,
): Promise<void> {
  const resolvedSnapshot = snapshot ?? (await readMarathonCoreRestartGuardSnapshot())
  const forceOverride = isMarathonCoreRestartForceOverride()
  const payload = buildMarathonCoreRestartGuardStateFilePayload(resolvedSnapshot, forceOverride)
  const statePath = getMarathonCoreRestartGuardStateFilePath()
  await mkdir(join(homedir(), '.sparkle'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(payload)}\n`, 'utf-8')
}

export async function evaluateMarathonCoreColdRestart(
  caller: CoreLifecycleCaller,
  forceRequested = false,
): Promise<{ blocked: boolean; snapshot: MarathonCoreRestartGuardSnapshot }> {
  const snapshot = await readMarathonCoreRestartGuardSnapshot()
  const forceOverride = forceRequested || isMarathonCoreRestartForceOverride()
  const decision = shouldBlockMarathonCoreColdRestart(snapshot, forceOverride)
  await refreshMarathonCoreRestartGuardStateFile(snapshot)

  if (decision.blocked) {
    await appendAppLog(formatCoreLifecycleBlockedLog(caller, decision, snapshot))
    return { blocked: true, snapshot }
  }

  await appendAppLog(formatCoreLifecycleScheduledLog(caller, snapshot))
  return { blocked: false, snapshot }
}
