import { appendAppLog } from '../utils/log'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'
import { probeMihomoControllerVersion } from './mihomoControllerReadyCore'
import { beginProbeWarmup, endProbeWarmup } from './probeWarmupState'

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

/** 内核就绪后：自动选择延迟排序与粘性固定、订阅更新器、Cursor 专用组默认节点、地区 url-test 预热。 */
export async function runPostCoreBootstrap(coreInitPromise: Promise<void>): Promise<void> {
  await Promise.race([coreInitPromise, delay(CORE_INIT_RACE_MS)])

  const apiReady = await waitForMihomoControllerReady()
  if (!apiReady) {
    await appendAppLog('[PostCoreBootstrap]: mihomo API not reachable after 30s — post-core services not started\n')
    return
  }

  await appendAppLog('[PostCoreBootstrap]: mihomo API ready — scheduling post-core services\n')

  // 窗口覆盖冷启动批量测速；地区组预热结束（或任一步骤抛错）时收口。
  beginProbeWarmup()
  try {
    await runPostReadyServices()
  } catch (error) {
    endProbeWarmup()
    throw error
  }
}

async function runPostReadyServices(): Promise<void> {
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

  void (async () => {
    try {
      const { bootstrapSparkleGeminiRegionAudit, startSparkleGeminiRegionAuditLoop } =
        await import('./sparkleGeminiProbe')
      await bootstrapSparkleGeminiRegionAudit()
      startSparkleGeminiRegionAuditLoop()
    } catch (error) {
      await appendAppLog(
        `[SparkleGeminiProbe]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  })()

  void (async () => {
    try {
      const { bootstrapSparkleMailProvider, startSparkleMailProbeLoop } = await import(
        './sparkleMailProbe'
      )
      await bootstrapSparkleMailProvider()
      startSparkleMailProbeLoop()
    } catch (error) {
      await appendAppLog(
        `[SparkleMailProbe]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  })()

  // 排序失败也要启动：固定逻辑只依赖 controller，与重排相互独立。
  const { startAutoSelectStickyPin } = await import('./autoSelectStickyPin')
  startAutoSelectStickyPin()

  const { mihomoGroups, mihomoChangeProxy, mihomoGroupDelay } = await import('./mihomoApi')

  const { initProfileUpdater } = await import('./profileUpdater')
  initProfileUpdater()

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
        // 地区组预热是组内并发测速，易产生误报；对最近一次样本不是成功的节点（超时/不稳定/未测）做一次低并发复测。
        const { verifyUnconfirmedFailures } = await import('./providerLeafProbe')
        await verifyUnconfirmedFailures()
      } catch (error) {
        await appendAppLog(
          `[PostCoreBootstrap]: regional url-test warmup failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      } finally {
        endProbeWarmup()
      }
    })()
  }, NETWORK_MONITOR_STARTUP_GRACE_MS)
}
