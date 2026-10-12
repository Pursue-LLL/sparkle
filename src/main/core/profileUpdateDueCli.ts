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

/** Headless one-shot: refresh due remote subscriptions then exit (LaunchAgent). */
export async function runProfileUpdateDueCli(): Promise<number> {
  await appendAppLog('[ProfileUpdaterCli]: bootstrap start\n')

  let updatedCount: number
  try {
    const { runCoreReadinessPipeline } = await import('./coreReadinessGate')
    const { startPromise } = await runCoreReadinessPipeline('profile-update-cli')
    await Promise.race([startPromise, delay(CORE_INIT_RACE_MS)])

    updatedCount = await runDueProfileUpdates()
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
