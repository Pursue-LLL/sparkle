import { appendAppLog } from '../utils/log'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'

const MIHOMO_API_READY_MAX_WAIT_MS = 30_000
const CORE_INIT_RACE_MS = 8_000
const API_RETRY_INTERVAL_MS = 500

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForMihomoControllerReady(
  maxWaitMs: number = MIHOMO_API_READY_MAX_WAIT_MS
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      const { mihomoVersion } = await import('./mihomoApi')
      await mihomoVersion()
      return true
    } catch {
      await delay(API_RETRY_INTERVAL_MS)
    }
  }
  return false
}

/** Bootstrap profile updater, VPS default, and network monitor without blocking on WS streams. */
export async function runPostCoreBootstrap(coreInitPromise: Promise<void>): Promise<void> {
  await Promise.race([coreInitPromise, delay(CORE_INIT_RACE_MS)])

  const apiReady = await waitForMihomoControllerReady()
  if (!apiReady) {
    await appendAppLog(
      '[PostCoreBootstrap]: mihomo API not reachable after 30s — network monitor not started\n'
    )
    return
  }

  await appendAppLog('[PostCoreBootstrap]: mihomo API ready — scheduling post-core services\n')

  const { mihomoGroups, mihomoChangeProxy, mihomoGroupDelay } = await import('./mihomoApi')
  const { registerMihomoGroupsAccessor } = await import('./networkStabilityMonitor')
  registerMihomoGroupsAccessor(mihomoGroups)

  const { initProfileUpdater } = await import('./profileUpdater')
  await initProfileUpdater()

  try {
    const { applyCursorDedicatedVpsSelection } = await import('./cursorDedicatedDefault')
    const switched = await applyCursorDedicatedVpsSelection({ mihomoGroups, mihomoChangeProxy })
    if (!switched) {
      await appendAppLog('[PostCoreBootstrap]: Cursor dedicated VPS default unchanged or skipped\n')
    }
  } catch (error) {
    await appendAppLog(
      `[PostCoreBootstrap]: Cursor dedicated VPS default failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }

  setTimeout(() => {
    void (async () => {
      try {
        const { warmupRegionalUrlTestGroups } = await import('./regionalUrlTestWarmup')
        const warmed = await warmupRegionalUrlTestGroups({ mihomoGroups, mihomoGroupDelay })
        if (warmed > 0) {
          await appendAppLog(
            `[PostCoreBootstrap]: regional url-test warmup (${warmed} groups) after ${NETWORK_MONITOR_STARTUP_GRACE_MS / 1000}s grace\n`
          )
        }
      } catch (error) {
        await appendAppLog(
          `[PostCoreBootstrap]: regional url-test warmup failed: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }

      const { startApi2ProbePlane } = await import('./api2ProbePlane')
      await startApi2ProbePlane()

      const { startAgentTransportFailureSync } = await import('./agentTransportFailureSync')
      startAgentTransportFailureSync()

      await appendAppLog(
        `[PostCoreBootstrap]: Api2ProbePlane ON after ${NETWORK_MONITOR_STARTUP_GRACE_MS / 1000}s grace (60s active transport probe)\n`
      )
    })()
  }, NETWORK_MONITOR_STARTUP_GRACE_MS)
}
