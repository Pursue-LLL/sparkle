// [INPUT] mihomoApi::mihomoGroups/mihomoChangeProxy/mihomoGetConnections/mihomoGroupDelay (POS: mihomo 控制器访问层) ·
//         runtimeConfigSync::syncRuntimeConfigToCore (POS: 运行时配置对齐执行层) ·
//         autoSwitchPinRelease::releaseAutoSwitchPins (POS: 自动切换组固定释放执行层) ·
//         sparkleFastLatencyOrder::bootstrapSparkleFastLatencyOrder (POS: sparkle-fast 延迟序) ·
//         groupFailover::startGroupFailover (POS: 故障转移引擎接线) ·
//         sparkleMailProbe/sparkleMailCurrentNodeProbe (POS: 邮件 provider 全量探测/当前节点按需复测) ·
//         regionalUrlTestWarmup (POS: 地区组按需预热) · utils/bestEffortLog · utils/errorMessage::describeError
// [OUTPUT] runPostCoreBootstrap: 内核就绪后的单一启动编排入口 · waitForMihomoControllerReady
// [POS] 内核就绪后的单一启动编排入口。运行时配置对齐与自动组固定释放、延迟序、粘性固定、故障转移、邮件探测、agy 巡检、订阅更新、Cursor 默认节点、地区组按需预热。
//       每个服务各自隔离：任一服务启动失败只记日志，不影响其余服务（尤其是故障转移）；日志写入失败同样不改变启动流程。

import { bestEffortLog } from '../utils/bestEffortLog'
import { describeError } from '../utils/errorMessage'
import { appendAppLog } from '../utils/log'
import { NETWORK_MONITOR_STARTUP_GRACE_MS } from './networkStartupGraceCore'
import { probeMihomoControllerVersion } from './mihomoControllerReadyCore'
import { beginProbeWarmup, endProbeWarmup } from './probeWarmupState'

const MIHOMO_API_READY_MAX_WAIT_MS = 30_000
const CORE_INIT_RACE_MS = 8_000
const API_RETRY_INTERVAL_MS = 500

const writeLog = bestEffortLog(appendAppLog)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** 执行一个启动步骤；失败只记 `${failureLabel}: 原因`，永不抛出。 */
async function guarded(failureLabel: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    await writeLog(`${failureLabel}: ${describeError(error)}\n`)
  }
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
      : (JSON.stringify(lastError) ?? String(lastError))
  await writeLog(`[PostCoreBootstrap]: controller probe last_error=${detail.slice(0, 400)}\n`)
  return false
}

/** 内核就绪后：自动选择延迟排序与粘性固定、故障转移、订阅更新器、Cursor 专用组默认节点、地区 url-test 预热。 */
export async function runPostCoreBootstrap(coreInitPromise: Promise<void>): Promise<void> {
  await Promise.race([coreInitPromise, delay(CORE_INIT_RACE_MS)])

  if (!(await waitForMihomoControllerReady())) {
    await writeLog(
      '[PostCoreBootstrap]: mihomo API not reachable after 30s — post-core services not started\n'
    )
    return
  }

  await writeLog('[PostCoreBootstrap]: mihomo API ready — scheduling post-core services\n')

  // 窗口覆盖冷启动批量测速，由 runPostReadyServices 末尾排定的地区组预热收口。
  beginProbeWarmup()
  await runPostReadyServices()
}

/** 各服务相互隔离，本函数不会抛出：预热窗口一定会由末尾的定时任务关闭。 */
async function runPostReadyServices(): Promise<void> {
  // 服务模式下内核可能由更早的会话保留：先让它采用磁盘上的最新配置（整配置重载已含固定释放），
  // 再执行依赖规则 / 分组的后续步骤。
  await guarded('[PostCoreBootstrap]: runtime config sync failed', async () => {
    const { syncRuntimeConfigToCore } = await import('./runtimeConfigSync')
    if (!(await syncRuntimeConfigToCore())) {
      const { releaseAutoSwitchPins } = await import('./autoSwitchPinRelease')
      await releaseAutoSwitchPins('all')
    }
  })

  await guarded('[SparkleFastOrder]: failed', async () => {
    const { bootstrapSparkleFastLatencyOrder, startSparkleFastLatencyOrderLoop } =
      await import('./sparkleFastLatencyOrder')
    await bootstrapSparkleFastLatencyOrder()
    startSparkleFastLatencyOrderLoop()
  })

  // 以下探测相互独立且耗时，放到后台并行，不阻塞后面的服务启动。
  void guarded('[SparkleGeminiProbe]: bootstrap failed', async () => {
    const { bootstrapSparkleGeminiRegionAudit, startSparkleGeminiRegionAuditLoop } =
      await import('./sparkleGeminiProbe')
    await bootstrapSparkleGeminiRegionAudit()
    startSparkleGeminiRegionAuditLoop()
  })

  void guarded('[SparkleMailProbe]: bootstrap failed', async () => {
    const { bootstrapSparkleMailProvider, startSparkleMailProbeLoop } =
      await import('./sparkleMailProbe')
    await guarded('[SparkleMailProbe]: current node probe start failed', async () => {
      const { startSparkleMailCurrentNodeProbeLoop } = await import('./sparkleMailCurrentNodeProbe')
      startSparkleMailCurrentNodeProbeLoop()
    })
    await bootstrapSparkleMailProvider()
    startSparkleMailProbeLoop()
  })

  void guarded('[SparkleGrokProbe]: bootstrap failed', async () => {
    const { bootstrapSparkleGrokProvider, startSparkleGrokProbeLoop } =
      await import('./sparkleGrokProbe')
    await bootstrapSparkleGrokProvider()
    startSparkleGrokProbeLoop()
  })

  void guarded('[SparkleAgyProbe]: bootstrap failed', async () => {
    const { bootstrapSparkleAgyProvider, startSparkleAgyProbeLoop } =
      await import('./sparkleAgyProbe')
    await bootstrapSparkleAgyProvider()
    startSparkleAgyProbeLoop()
  })

  // 排序失败也要启动：固定逻辑只依赖 controller，与重排相互独立。
  await guarded('[AutoSelectSticky]: start failed', async () => {
    const { startAutoSelectStickyPin } = await import('./autoSelectStickyPin')
    startAutoSelectStickyPin()
  })

  await guarded('[GroupFailover]: start failed', async () => {
    const { startGroupFailover } = await import('./groupFailover')
    startGroupFailover()
  })

  await guarded('[ProfileUpdater]: init failed', async () => {
    const { initProfileUpdater } = await import('./profileUpdater')
    initProfileUpdater()
  })

  await guarded('[PostCoreBootstrap]: Cursor dedicated VPS default failed', async () => {
    const { mihomoGroups, mihomoChangeProxy } = await import('./mihomoApi')
    const { applyCursorDedicatedVpsSelection } = await import('./cursorDedicatedDefault')
    if (!(await applyCursorDedicatedVpsSelection({ mihomoGroups, mihomoChangeProxy }))) {
      await writeLog('[PostCoreBootstrap]: Cursor dedicated VPS default unchanged or skipped\n')
    }
  })

  setTimeout(() => {
    void guarded('[PostCoreBootstrap]: regional url-test warmup failed', warmupRegionalGroups).then(
      endProbeWarmup
    )
  }, NETWORK_MONITOR_STARTUP_GRACE_MS)
}

async function warmupRegionalGroups(): Promise<void> {
  const { collectActiveWarmupGroupNames, warmupRegionalUrlTestGroups } =
    await import('./regionalUrlTestWarmup')
  const { mihomoGroups, mihomoGetConnections, mihomoGroupDelay } = await import('./mihomoApi')
  const groups = await mihomoGroups()
  const connections = await mihomoGetConnections().catch(() => undefined)
  const activeGroupNames = collectActiveWarmupGroupNames(groups, connections)
  const warmed = await warmupRegionalUrlTestGroups(
    { mihomoGroups, mihomoGroupDelay },
    activeGroupNames
  )
  if (warmed > 0) {
    await writeLog(
      `[PostCoreBootstrap]: regional url-test warmup (${warmed} groups) after ${NETWORK_MONITOR_STARTUP_GRACE_MS / 1000}s grace\n`
    )
    // 地区组预热是组内并发测速，易产生误报；对最近一次样本不是成功的节点（超时/不稳定/未测）做一次低并发复测。
    const { verifyUnconfirmedFailures } = await import('./providerLeafProbe')
    await verifyUnconfirmedFailures()
  } else {
    await writeLog(
      `[PostCoreBootstrap]: regional url-test warmup skipped active_groups=${activeGroupNames.size}\n`
    )
  }
}
