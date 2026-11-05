// [INPUT] autoSwitchGroupIntegrityCore::reconcileStartupAutoSwitchGroups/detectDeadlockAutoSwitchGroups (POS: 自动切换组零死锁核心决策层) ·
//         mihomoApi::mihomoGroups/mihomoProxyProviders/mihomoUnfixedProxy/mihomoGroupDelay/mihomoCloseConnections (POS: mihomo 控制器访问层) ·
//         utils/log::appendAppLog (POS: 应用程序运行日志追加写入)
// [OUTPUT] reconcileAutoSwitchGroupsOnStartup · reconcileAutoSwitchGroupsNow · startAutoSwitchGroupIntegrityWatchdog · stopAutoSwitchGroupIntegrityWatchdog: 自动切换组零死锁运行时守护服务
// [POS] 自动切换组（URLTest / 地区自动组 / 自动选择）零死锁守护运行层。负责启动与配置刷新时的纯净解钉、周期性死锁自愈熔断看门狗，确保自动切换组永不死锁。

import { appendAppLog } from '../utils/log'
import {
  detectDeadlockAutoSwitchGroups,
  isAutoSwitchGroup,
  reconcileStartupAutoSwitchGroups,
  type AutoSwitchGroupSnapshot
} from './autoSwitchGroupIntegrityCore'
import {
  mihomoCloseConnections,
  mihomoGroupDelay,
  mihomoGroups,
  mihomoProxyProviders,
  mihomoUnfixedProxy
} from './mihomoApi'

const WATCHDOG_INTERVAL_MS = 10_000

let watchdogTimer: NodeJS.Timeout | null = null
let watchdogRunning = false

function mapToGroupSnapshots(groups: ControllerMixedGroup[]): AutoSwitchGroupSnapshot[] {
  return groups.map((g) => ({
    name: g.name,
    type: g.type,
    now: g.now ?? '',
    fixed: g.fixed ?? '',
    all: (g.all ?? []).map((item: unknown) =>
      typeof item === 'string' ? item : ((item as { name?: string })?.name ?? '')
    ),
    testUrl: g.testUrl
  }))
}

function buildNodeHealthChecker(
  providers: ControllerProxyProviders | null
): (node: string, testUrl?: string) => boolean {
  if (!providers?.providers) {
    return () => true
  }

  const lookup = new Map<string, { alive?: boolean; extra?: Record<string, { alive?: boolean; delay?: number }> }>()
  for (const provider of Object.values(providers.providers)) {
    for (const proxy of provider.proxies ?? []) {
      lookup.set(proxy.name, proxy)
    }
  }

  return (node: string, testUrl?: string): boolean => {
    const leaf = lookup.get(node)
    if (!leaf) {
      // 找不到节点定义，判定为不存在/失活
      return false
    }

    if (testUrl && leaf.extra?.[testUrl] !== undefined) {
      const probe = leaf.extra[testUrl]
      if (probe.alive !== undefined) {
        return probe.alive
      }
      return typeof probe.delay === 'number' && probe.delay > 0
    }

    return leaf.alive ?? true
  }
}

/**
 * 启动时对齐：彻底清除 cache.db 恢复对 URLTest 自动组强加的 fixed 锁定。
 */
export async function reconcileAutoSwitchGroupsOnStartup(): Promise<number> {
  try {
    const rawGroups = await mihomoGroups().catch(() => [])
    if (!rawGroups || rawGroups.length === 0) {
      return 0
    }

    const snapshots = mapToGroupSnapshots(rawGroups)
    const actions = reconcileStartupAutoSwitchGroups(snapshots)

    for (const action of actions) {
      if (action.kind === 'unfix') {
        await mihomoUnfixedProxy(action.group).catch(() => {})
        await appendAppLog(
          `[AutoSwitchIntegrity]: startup unpinned ${action.group} (was fixed to ${action.fixedNode}, reason=${action.reason})\n`
        )
        void mihomoGroupDelay(action.group).catch(() => {})
      }
    }

    return actions.length
  } catch (error) {
    await appendAppLog(
      `[AutoSwitchIntegrity]: startup reconcile failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
    return 0
  }
}

/**
 * 运行时单次核查（配置重载/订阅刷新后调用）：清除孤儿固定或异常固定。
 */
export async function reconcileAutoSwitchGroupsNow(): Promise<number> {
  return await reconcileAutoSwitchGroupsOnStartup()
}

/**
 * 看门狗单次执行：检查所有固定节点的自动组，若节点已挂或成孤儿，立即熔断解钉。
 */
async function checkDeadlocksOnce(): Promise<void> {
  if (watchdogRunning) return
  watchdogRunning = true

  try {
    const rawGroups = await mihomoGroups().catch(() => [])
    if (!rawGroups || rawGroups.length === 0) {
      return
    }

    // 快速过滤：如果没有任一自动组有 fixed，直接 0 额外开销退出
    const hasAnyFixed = rawGroups.some(
      (g) => isAutoSwitchGroup(g) && (g.fixed ?? '').trim() !== ''
    )
    if (!hasAnyFixed) {
      return
    }

    const providers = await mihomoProxyProviders().catch(() => null)
    const isNodeAlive = buildNodeHealthChecker(providers)
    const snapshots = mapToGroupSnapshots(rawGroups)
    const actions = detectDeadlockAutoSwitchGroups(snapshots, isNodeAlive)

    for (const action of actions) {
      if (action.kind === 'unfix') {
        await mihomoUnfixedProxy(action.group).catch(() => {})
        await mihomoCloseConnections(action.group).catch(() => {})
        await appendAppLog(
          `[AutoSwitchIntegrity]: unlocked dead pinned node in ${action.group} -> unpinned ${action.fixedNode} (reason=${action.reason})\n`
        )
        // 立即唤起策略组测速以让 mihomo 切到最新活节点
        void mihomoGroupDelay(action.group).catch(() => {})
      }
    }
  } catch (error) {
    // 守护异常不中断主流程
  } finally {
    watchdogRunning = false
  }
}

/**
 * 启动死锁熔断看门狗。
 */
export function startAutoSwitchGroupIntegrityWatchdog(
  intervalMs: number = WATCHDOG_INTERVAL_MS
): void {
  stopAutoSwitchGroupIntegrityWatchdog()
  watchdogTimer = setInterval(() => {
    void checkDeadlocksOnce()
  }, intervalMs)
}

/**
 * 停止死锁熔断看门狗。
 */
export function stopAutoSwitchGroupIntegrityWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  watchdogRunning = false
}
