// [INPUT] mihomoApi::mihomoGroups/mihomoChangeProxy/mihomoGetConnections/mihomoGroupDelay (POS: mihomo 控制器访问层) ·
//         autoSwitchGroupIntegrity::reconcileAutoSwitchGroupsOnStartup/startAutoSwitchGroupIntegrityWatchdog (POS: 自动切换组零死锁守护运行层) ·
//         sparkleFastLatencyOrder::bootstrapSparkleFastLatencyOrder (POS: sparkle-fast 延迟序) ·
//         sparkleMailProbe/sparkleMailCurrentNodeProbe (POS: 邮件 provider 全量探测/当前节点按需复测) ·
//         regionalUrlTestWarmup (POS: 地区组按需预热)
// [OUTPUT] runPostCoreBootstrap: 内核就绪后的单一启动编排入口
// [POS] 内核就绪后的单一启动编排入口。自动组零死锁对齐与守护、延迟序、粘性固定、邮件探测、agy 巡检、订阅更新、Cursor 默认节点、地区组按需预热。

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
    const { reconcileAutoSwitchGroupsOnStartup, startAutoSwitchGroupIntegrityWatchdog } =
      await import('./autoSwitchGroupIntegrity')
    await reconcileAutoSwitchGroupsOnStartup()
    startAutoSwitchGroupIntegrityWatchdog()
  } catch (error) {
    await appendAppLog(
      `[AutoSwitchIntegrity]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }

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
      try {
        const { startSparkleMailCurrentNodeProbeLoop } = await import(
          './sparkleMailCurrentNodeProbe'
        )
        startSparkleMailCurrentNodeProbeLoop()
      } catch (error) {
        await appendAppLog(
          `[SparkleMailProbe]: current node probe start failed: ${error instanceof Error ? error.message : String(error)}\n`
        )
      }
      await bootstrapSparkleMailProvider()
      startSparkleMailProbeLoop()
    } catch (error) {
      await appendAppLog(
        `[SparkleMailProbe]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  })()

  void (async () => {
    try {
      const { bootstrapSparkleGrokProvider, startSparkleGrokProbeLoop } = await import(
        './sparkleGrokProbe'
      )
      await bootstrapSparkleGrokProvider()
      startSparkleGrokProbeLoop()
    } catch (error) {
      await appendAppLog(
        `[SparkleGrokProbe]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  })()

  void (async () => {
    try {
      const { bootstrapSparkleAgyProvider, startSparkleAgyProbeLoop } = await import(
        './sparkleAgyProbe'
      )
      await bootstrapSparkleAgyProvider()
      startSparkleAgyProbeLoop()
    } catch (error) {
      await appendAppLog(
        `[SparkleAgyProbe]: bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  })()

  // 排序失败也要启动：固定逻辑只依赖 controller，与重排相互独立。
  const { startAutoSelectStickyPin } = await import('./autoSelectStickyPin')
  startAutoSelectStickyPin()

  const { mihomoGroups, mihomoChangeProxy, mihomoGetConnections, mihomoGroupDelay } = await import(
    './mihomoApi'
  )

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
        const { collectActiveWarmupGroupNames, warmupRegionalUrlTestGroups } = await import(
          './regionalUrlTestWarmup'
        )
        const groups = await mihomoGroups()
        const connections = await mihomoGetConnections().catch(() => undefined)
        const activeGroupNames = collectActiveWarmupGroupNames(groups, connections)
        const warmed = await warmupRegionalUrlTestGroups(
          { mihomoGroups, mihomoGroupDelay },
          activeGroupNames
        )
        if (warmed > 0) {
          await appendAppLog(
            `[PostCoreBootstrap]: regional url-test warmup (${warmed} groups) after ${NETWORK_MONITOR_STARTUP_GRACE_MS / 1000}s grace\n`,
          )
          // 地区组预热是组内并发测速，易产生误报；对最近一次样本不是成功的节点（超时/不稳定/未测）做一次低并发复测。
          const { verifyUnconfirmedFailures } = await import('./providerLeafProbe')
          await verifyUnconfirmedFailures()
        } else {
          await appendAppLog(
            `[PostCoreBootstrap]: regional url-test warmup skipped active_groups=${activeGroupNames.size}\n`,
          )
        }
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
