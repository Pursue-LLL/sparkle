import { mihomoGetConnections } from './mihomoApi'
import { quitWithoutCore } from './manager'
import { runDueProfileUpdates } from './profileUpdater'
import { appendAppLog } from '../utils/log'
import { markGracefulGuiQuit } from '../sys/guiGracefulQuitMarker'

const CORE_INIT_RACE_MS = 8_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function evaluateProfileUpdateBootstrapGuard(): Promise<{
  blocked: boolean
  snapshot: { cursorConnectionCount: number; recentActiveLifecycleStreamCount: number; quiesceActive: boolean }
}> {
  const { evaluateBootstrapCoreStartGuard } = await import('./marathonCoreRestartGuard')
  return evaluateBootstrapCoreStartGuard('profile-update-cli')
}

function formatProfileUpdateDeferLog(
  scope: string,
  guard: {
    snapshot: { cursorConnectionCount: number; recentActiveLifecycleStreamCount: number; quiesceActive: boolean }
  },
): string {
  return (
    `[ProfileUpdaterCli]: ${scope} deferred data_plane_mutation_blocked cursor_conn=${guard.snapshot.cursorConnectionCount} ` +
    `recent_active_lifecycle=${guard.snapshot.recentActiveLifecycleStreamCount} quiesce=${guard.snapshot.quiesceActive ? 1 : 0}\n`
  )
}

/** Due-check for LaunchAgent second-instance — provider hot-reload is connection-safe
 * (no core restart), so the cold-restart guard must not gate it. Stream protection
 * lives in the reload path itself (`shouldDeferProfileProviderReload`). */
export async function runGuardedDueProfileUpdatesSecondInstance(): Promise<number | null> {
  return runDueProfileUpdates('cli')
}

/** Headless one-shot: refresh due remote subscriptions then exit (LaunchAgent / second-instance). */
export async function runProfileUpdateDueCli(): Promise<number> {
  await appendAppLog('[ProfileUpdaterCli]: bootstrap start\n')

  try {
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

  let updatedCount: number
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
