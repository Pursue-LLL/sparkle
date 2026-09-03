import { quitWithoutCore } from './manager'
import { runDueProfileUpdates } from './profileUpdater'
import { appendAppLog } from '../utils/log'
import { markGracefulGuiQuit } from '../sys/guiGracefulQuitMarker'
import type { MarathonCoreRestartGuardSnapshot } from './marathonCoreRestartGuardCore'

const CORE_INIT_RACE_MS = 8_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function evaluateProfileUpdateBootstrapGuard(): Promise<{
  blocked: boolean
  snapshot: MarathonCoreRestartGuardSnapshot
}> {
  const { evaluateBootstrapCoreStartGuard } = await import('./marathonCoreRestartGuard')
  return evaluateBootstrapCoreStartGuard('profile-update-cli')
}

async function evaluateProfileUpdateDueGuard(): Promise<{
  blocked: boolean
  snapshot: MarathonCoreRestartGuardSnapshot
}> {
  const { evaluateMarathonCoreColdRestart } = await import('./marathonCoreRestartGuard')
  return evaluateMarathonCoreColdRestart('profile-update-cli', false)
}

function formatProfileUpdateDeferLog(
  scope: string,
  guard: { snapshot: MarathonCoreRestartGuardSnapshot },
): string {
  return (
    `[ProfileUpdaterCli]: ${scope} deferred data_plane_mutation_blocked cursor_conn=${guard.snapshot.cursorConnectionCount} ` +
    `recent_active_lifecycle=${guard.snapshot.recentActiveLifecycleStreamCount} quiesce=${guard.snapshot.quiesceActive ? 1 : 0}\n`
  )
}

/** Guarded due-check for LaunchAgent second-instance (core already running — no cold restart). */
export async function runGuardedDueProfileUpdatesSecondInstance(): Promise<number | null> {
  const guard = await evaluateProfileUpdateDueGuard()
  if (guard.blocked) {
    await appendAppLog(formatProfileUpdateDeferLog('second-instance', guard))
    const { markDeferredProfileUpdateDue } = await import('./deferredProfileUpdateDue')
    await markDeferredProfileUpdateDue('second-instance')
    return null
  }
  return runDueProfileUpdates('cli')
}

/** Headless one-shot: refresh due remote subscriptions then exit (LaunchAgent / second-instance). */
export async function runProfileUpdateDueCli(): Promise<number> {
  await appendAppLog('[ProfileUpdaterCli]: bootstrap start\n')

  try {
    const { mihomoGetConnections } = await import('./mihomoApi')
    const { isMihomoDataPlaneBusy } = await import('./mihomoDataPlaneLoadCore')
    const { updateCachedMihomoActiveConnectionCount } = await import('./mihomoDataPlaneLoadState')
    const connections = await mihomoGetConnections().catch(() => null)
    const activeCount = connections?.connections?.length ?? 0
    updateCachedMihomoActiveConnectionCount(activeCount)
    if (isMihomoDataPlaneBusy(activeCount)) {
      await appendAppLog(
        `[ProfileUpdaterCli]: deferred data_plane_busy active_connections=${activeCount}\n`,
      )
      const { markDeferredProfileUpdateDue } = await import('./deferredProfileUpdateDue')
      await markDeferredProfileUpdateDue('profile-update-cli')
      return 0
    }
  } catch {
    // fall through — guard layers below still protect data plane
  }

  const guard = await evaluateProfileUpdateBootstrapGuard()
  if (guard.blocked) {
    await appendAppLog(formatProfileUpdateDeferLog('deferred', guard))
    const { markDeferredProfileUpdateDue } = await import('./deferredProfileUpdateDue')
    await markDeferredProfileUpdateDue('profile-update-cli')
    return 0
  }

  let updatedCount = 0
  try {
    const { runCoreReadinessPipeline } = await import('./coreReadinessGate')
    const { startPromise } = await runCoreReadinessPipeline('profile-update-cli')
    await Promise.race([startPromise, delay(CORE_INIT_RACE_MS)])

    updatedCount = await runDueProfileUpdates('cli')
    await appendAppLog(`[ProfileUpdaterCli]: complete updated_count=${updatedCount}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[ProfileUpdaterCli]: failed: ${message}\n`)
    throw error
  } finally {
    markGracefulGuiQuit()
    await quitWithoutCore()
  }

  return updatedCount
}
