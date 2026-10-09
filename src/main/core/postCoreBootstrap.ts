import { appendAppLog } from '../utils/log'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'
import { probeMihomoControllerVersion } from './mihomoControllerReadyCore'

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
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await probeMihomoControllerVersion()
      return true
    } catch (error) {
      lastError = error
      await delay(API_RETRY_INTERVAL_MS)
    }
  }
  const detail =
    lastError instanceof Error
      ? `${lastError.name}: ${lastError.message}`
      : JSON.stringify(lastError) ?? String(lastError)
  await appendAppLog(`[PostCoreBootstrap]: controller probe last_error=${detail.slice(0, 400)}\n`)
  return false
}

/** 内核就绪后：自动选择延迟排序、订阅更新器、Cursor 专用组默认节点、地区 url-test 预热。 */
export async function runPostCoreBootstrap(coreInitPromise: Promise<void>): Promise<void> {
  await Promise.race([coreInitPromise, delay(CORE_INIT_RACE_MS)])

  const apiReady = await waitForMihomoControllerReady()
  if (!apiReady) {
    await appendAppLog('[PostCoreBootstrap]: mihomo API not reachable after 30s — post-core services not started\n')
    return
  }

  await appendAppLog('[PostCoreBootstrap]: mihomo API ready — scheduling post-core services\n')

  try {
    const { bootstrapSparkleFastLatencyOrder, startSparkleFastLatencyOrderLoop } = await import(
      './sparkleFastLatencyOrder'
    )
    await bootstrapSparkleFastLatencyOrder()
    startSparkleFastLatencyOrderLoop()
  } catch (error) {
    await appendAppLog(
      `[SparkleFastOrder]: failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }

  const { mihomoGroups, mihomoChangeProxy, mihomoGroupDelay } = await import('./mihomoApi')

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
            `[PostCoreBootstrap]: regional url-test warmup (${warmed} groups) after ${NETWORK_MONITOR_STARTUP_GRACE_MS / 1000}s grace\n`,
          )
        }
      } catch (error) {
        await appendAppLog(
          `[PostCoreBootstrap]: regional url-test warmup failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
    })()
  }, NETWORK_MONITOR_STARTUP_GRACE_MS)
}
