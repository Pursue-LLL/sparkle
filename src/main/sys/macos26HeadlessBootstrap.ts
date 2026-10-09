import { quitWithoutCore } from '../core/manager'
import { appendAppLog } from '../utils/log'
import { markGracefulGuiQuit } from './guiGracefulQuitMarker'

const CORE_INIT_RACE_MS = 8_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Start core + post-core defaults, then exit GUI cleanly (sparkle-service keeps proxy on macOS 26). */
export async function runMacOs26HeadlessBootstrap(): Promise<void> {
  await appendAppLog('[MacOs26Headless]: bootstrap start (no BrowserWindow)\n')

  try {
    const { runCoreReadinessPipeline } = await import('../core/coreReadinessGate')
    const { startPromise } = await runCoreReadinessPipeline('macos26-headless-bootstrap')
    await Promise.race([startPromise, delay(CORE_INIT_RACE_MS)])
    await appendAppLog('[MacOs26Headless]: bootstrap complete api_ready=1\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendAppLog(`[MacOs26Headless]: bootstrap failed: ${message}\n`)
  } finally {
    markGracefulGuiQuit()
    await quitWithoutCore()
  }
}
