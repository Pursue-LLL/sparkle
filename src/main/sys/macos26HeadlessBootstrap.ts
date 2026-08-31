import { quitWithoutCore } from '../core/manager'
import { appendAppLog } from '../utils/log'
import { markGracefulGuiQuit } from './guiGracefulQuitMarker'

const CORE_INIT_RACE_MS = 8_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Start core + cursor defaults, then exit GUI cleanly (sparkle-service keeps proxy on macOS 26). */
export async function runMacOs26HeadlessBootstrap(): Promise<void> {
  await appendAppLog('[MacOs26Headless]: bootstrap start (no BrowserWindow)\n')

  const { evaluateBootstrapCoreStartGuard } = await import('../core/marathonCoreRestartGuard')
  const guard = await evaluateBootstrapCoreStartGuard('macos26-headless-bootstrap')
  if (guard.blocked) {
    await appendAppLog(
      `[MacOs26Headless]: deferred data_plane_mutation_blocked cursor_conn=${guard.snapshot.cursorConnectionCount} ` +
        `recent_active_lifecycle=${guard.snapshot.recentActiveLifecycleStreamCount} quiesce=${guard.snapshot.quiesceActive ? 1 : 0}\n`,
    )
    markGracefulGuiQuit()
    return
  }

  let apiReady = false
  try {
    const { runCoreReadinessPipeline } = await import('../core/coreReadinessGate')
    const { startPromise } = await runCoreReadinessPipeline('macos26-headless-bootstrap')
    await Promise.race([startPromise, delay(CORE_INIT_RACE_MS)])
    apiReady = true
    await appendAppLog(`[MacOs26Headless]: bootstrap complete api_ready=${apiReady ? 1 : 0}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[MacOs26Headless]: bootstrap failed: ${message}\n`)
  } finally {
    markGracefulGuiQuit()
    await quitWithoutCore()
  }
}
