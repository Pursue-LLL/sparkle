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
  type MarathonCoreRestartGuardSnapshot
} from './marathonCoreRestartGuardCore'

const GUARD_STATE_RELATIVE_PATH = join('.sparkle', 'marathon-core-restart-guard.json')

export function getMarathonCoreRestartGuardStateFilePath(): string {
  return join(homedir(), GUARD_STATE_RELATIVE_PATH)
}

export async function readMarathonCoreRestartGuardSnapshot(
  nowMs: number = Date.now()
): Promise<MarathonCoreRestartGuardSnapshot> {
  const quiesceSnapshot = getMarathonQuiesceSnapshot()
  const cursorConnectionCount = await countCursorConnections().catch(() => -1)
  let recentActiveLifecycleStreamCount: number
  try {
    const { readStreamLifecycleJournalTail } = await import('./streamLifecycleJournal')
    const { countRecentActiveLifecycleStreams } =
      await import('./marathonCoreRestartGuardLifecycleCore')
    const events = readStreamLifecycleJournalTail()
    recentActiveLifecycleStreamCount = countRecentActiveLifecycleStreams({
      events,
      nowMs
    })
  } catch {
    recentActiveLifecycleStreamCount = -1
  }
  return {
    quiesceActive: quiesceSnapshot.active,
    cursorConnectionCount,
    recentActiveLifecycleStreamCount,
    updatedAtMs: nowMs
  }
}

export async function refreshMarathonCoreRestartGuardStateFile(
  snapshot?: MarathonCoreRestartGuardSnapshot
): Promise<void> {
  const resolvedSnapshot = snapshot ?? (await readMarathonCoreRestartGuardSnapshot())
  const forceOverride = isMarathonCoreRestartForceOverride()
  const payload = buildMarathonCoreRestartGuardStateFilePayload(resolvedSnapshot, forceOverride)
  const statePath = getMarathonCoreRestartGuardStateFilePath()
  await mkdir(join(homedir(), '.sparkle'), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(payload)}\n`, 'utf-8')
}

const BOOTSTRAP_CORE_PROBE_MS = 800

export async function probeMihomoCoreLive(
  maxWaitMs: number = BOOTSTRAP_CORE_PROBE_MS
): Promise<boolean> {
  const { waitForMihomoControllerReady } = await import('./postCoreBootstrap')
  return waitForMihomoControllerReady(maxWaitMs)
}

export type BootstrapCoreStartCaller = Extract<
  CoreLifecycleCaller,
  'profile-update-cli' | 'macos26-headless-bootstrap' | 'stopCore' | 'startCore'
>

/** When mihomo is down, cursor_conn=-1 would block cold lifecycle forever — skip guard until core is live. */
export async function evaluateGuardSkipWhenNoLiveCore(
  caller: BootstrapCoreStartCaller
): Promise<{ blocked: boolean; snapshot: MarathonCoreRestartGuardSnapshot }> {
  const coreLive = await probeMihomoCoreLive()
  if (!coreLive) {
    await appendAppLog(
      `[CoreLifecycle]: lifecycle_guard_skip caller=${caller} reason=no_live_core cursor_conn_observation_skipped=1\n`
    )
    const snapshot: MarathonCoreRestartGuardSnapshot = {
      quiesceActive: false,
      cursorConnectionCount: 0,
      recentActiveLifecycleStreamCount: 0,
      updatedAtMs: Date.now()
    }
    return { blocked: false, snapshot }
  }
  return evaluateMarathonCoreColdRestart(caller, false)
}

/** @deprecated use evaluateGuardSkipWhenNoLiveCore */
export async function evaluateBootstrapCoreStartGuard(
  caller: Extract<BootstrapCoreStartCaller, 'profile-update-cli' | 'macos26-headless-bootstrap'>
): Promise<{ blocked: boolean; snapshot: MarathonCoreRestartGuardSnapshot }> {
  return evaluateGuardSkipWhenNoLiveCore(caller)
}

export async function evaluateMarathonCoreColdRestart(
  caller: CoreLifecycleCaller,
  forceRequested = false,
  emergency?: import('./marathonCoreRestartGuardCore').EmergencyCoreRecoveryGuardContext,
): Promise<{ blocked: boolean; snapshot: MarathonCoreRestartGuardSnapshot }> {
  const snapshot = await readMarathonCoreRestartGuardSnapshot()
  const forceOverride = forceRequested || isMarathonCoreRestartForceOverride()
  const decision = shouldBlockMarathonCoreColdRestart(snapshot, forceOverride, emergency)
  await refreshMarathonCoreRestartGuardStateFile(snapshot)

  if (decision.blocked) {
    const { planCoreLifecycleBlockedLog } = await import('./coreLifecycleBlockedLogThrottleCore')
    const planned = planCoreLifecycleBlockedLog({
      caller,
      reason: decision.reason,
      nowMs: Date.now(),
      formattedLine: formatCoreLifecycleBlockedLog(caller, decision, snapshot),
    })
    if (planned.emit) {
      await appendAppLog(planned.line)
    }
    return { blocked: true, snapshot }
  }

  await appendAppLog(formatCoreLifecycleScheduledLog(caller, snapshot))
  return { blocked: false, snapshot }
}
