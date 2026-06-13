import { getAppConfig } from '../config/app'
import { mihomoGroups, mihomoChangeProxy, mihomoProxyDelay } from './mihomoApi'
import { getProfileConfig, addProfileItem } from '../config/profile'
import { appendAppLog } from '../utils/log'
import { recordProxySwitch } from './networkStabilityMonitor'
import { showNotification } from '../utils/notification'
import { BrowserWindow } from 'electron'

let healthCheckTimer: NodeJS.Timeout | null = null
let isMonitoring = false
let isChecking = false
let lastFailoverAt = 0

const MIN_FAILOVER_INTERVAL_MS = 5 * 60_000
const DELAY_RECHECK_WAIT_MS = 2_000

const DEFAULT_PROXY_PRIORITY = ['新加坡', '台湾', '日本']

const BLOCKED_REGION_KEYWORDS = ['香港', 'hongkong', 'hong kong']

function getMainWindow(): BrowserWindow | null {
  const { mainWindow } = require('..')
  return mainWindow
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizePriorityList(priorityList: string[]): string[] {
  const filtered = priorityList.filter(
    (priority) =>
      !BLOCKED_REGION_KEYWORDS.some((blocked) =>
        priority.toLowerCase().includes(blocked.toLowerCase())
      )
  )
  return filtered.length > 0 ? filtered : DEFAULT_PROXY_PRIORITY
}

function isAllowedRegionProxy(proxyName: string, priorityList: string[]): boolean {
  return priorityList.some((priority) => proxyMatchesPriority(proxyName, priority))
}

function isDisallowedRegionProxy(proxyName: string, priorityList: string[]): boolean {
  return !isAllowedRegionProxy(proxyName, priorityList)
}

export async function startProxyHealthMonitor(): Promise<void> {
  if (isMonitoring) return

  const appConfig = await getAppConfig()
  const { autoProxySwitch = true, proxyHealthCheckInterval = 60 } = appConfig

  if (!autoProxySwitch) return

  isMonitoring = true
  appendAppLog('[ProxyHealthMonitor]: started (failover-only, SG/TW/JP)\n')

  void runHealthCheckSafely()

  healthCheckTimer = setInterval(async () => {
    if (isChecking) return
    await runHealthCheckSafely()
  }, proxyHealthCheckInterval * 1000)
}

async function runHealthCheckSafely(): Promise<void> {
  if (isChecking) return
  isChecking = true
  try {
    await checkProxyHealth()
  } catch (error) {
    appendAppLog(`[ProxyHealthMonitor]: health check error: ${formatError(error)}\n`)
  } finally {
    isChecking = false
  }
}

export function stopProxyHealthMonitor(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer)
    healthCheckTimer = null
  }
  isMonitoring = false
  appendAppLog('[ProxyHealthMonitor]: stopped\n')
}

export async function restartProxyHealthMonitor(): Promise<void> {
  stopProxyHealthMonitor()
  await startProxyHealthMonitor()
}

/**
 * Failover when Cursor api probe or external caller detects an unreachable proxy.
 * Does not switch when the current node is healthy (failover-only policy).
 */
export async function requestProxyFailover(trigger: string): Promise<boolean> {
  const appConfig = await getAppConfig()
  if (!appConfig.autoProxySwitch) {
    return false
  }

  const now = Date.now()
  if (now - lastFailoverAt < MIN_FAILOVER_INTERVAL_MS) {
    return false
  }

  if (isChecking) {
    return false
  }

  isChecking = true
  try {
    appendAppLog(`[ProxyHealthMonitor]: failover requested (${trigger})\n`)
    const switched = await runFailoverCheck(trigger)
    if (switched) {
      lastFailoverAt = now
    }
    return switched
  } finally {
    isChecking = false
  }
}

const INFO_NODE_PATTERNS = [
  /剩余流量/u,
  /套餐到期/u,
  /距离下次/u,
  /重置剩余/u,
  /官网/u,
  /邮件/u,
  /注意[:：]/u,
  /不推荐/u,
  /test\s*0\.1/i,
  /Hysteria2 test/i
]

const NON_ROUTING_PROXY_NAMES = new Set([
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'DNS',
  'NOOP',
  '自动选择',
  '故障转移',
  'GLOBAL'
])

function isRoutingProxyName(name: string): boolean {
  if (NON_ROUTING_PROXY_NAMES.has(name)) return false
  return !INFO_NODE_PATTERNS.some((pattern) => pattern.test(name))
}

function isRoutingProxy(proxy: ControllerProxiesDetail | ControllerGroupDetail): boolean {
  if ('all' in proxy && Array.isArray(proxy.all)) return false
  return isRoutingProxyName(proxy.name)
}

function getPrimaryProxyGroup(groups: ControllerMixedGroup[]): ControllerMixedGroup | undefined {
  return (
    groups.find((group) => group.type === 'Selector' && group.name !== 'GLOBAL') ??
    groups.find((group) => group.name !== 'GLOBAL')
  )
}

async function checkProxyHealth(): Promise<void> {
  const appConfig = await getAppConfig()
  const { proxyTimeoutThreshold = 5000, proxySwitchPriority = [] } = appConfig
  const priorityList = normalizePriorityList(proxySwitchPriority)

  const groups = await mihomoGroups()
  if (!groups || groups.length === 0) return

  const firstGroup = getPrimaryProxyGroup(groups)
  if (!firstGroup) return

  const currentProxy = firstGroup.now
  if (!currentProxy || !isRoutingProxyName(currentProxy)) {
    return
  }

  if (isDisallowedRegionProxy(currentProxy, priorityList)) {
    appendAppLog(
      `[ProxyHealthMonitor]: current proxy "${currentProxy}" is outside SG/TW/JP, switching\n`
    )
    await applyPrioritySelection(
      firstGroup,
      priorityList,
      currentProxy,
      proxyTimeoutThreshold,
      'disallowed-region'
    )
    return
  }

  const { delay: currentDelay, healthy: currentHealthy } = await measureProxyDelay(
    currentProxy,
    proxyTimeoutThreshold
  )

  if (!currentHealthy) {
    if (await shouldKeepProxyDespiteDelayFailure(currentProxy)) {
      return
    }

    appendAppLog(
      `[ProxyHealthMonitor]: proxy "${currentProxy}" unhealthy (delay=${currentDelay}ms), switching\n`
    )
    await applyPrioritySelection(
      firstGroup,
      priorityList,
      currentProxy,
      proxyTimeoutThreshold,
      'unhealthy'
    )
  }
}

async function measureProxyDelay(
  proxyName: string,
  proxyTimeoutThreshold: number
): Promise<{ delay: number; healthy: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const delayResult = await mihomoProxyDelay(proxyName)
      const delay = delayResult.delay ?? 0
      if (delay > 0 && delay < proxyTimeoutThreshold) {
        return { delay, healthy: true }
      }
    } catch (error) {
      if (attempt === 1) {
        appendAppLog(
          `[ProxyHealthMonitor]: delay test failed for "${proxyName}": ${formatError(error)}\n`
        )
      }
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_RECHECK_WAIT_MS))
    }
  }

  return { delay: -1, healthy: false }
}

async function shouldKeepProxyDespiteDelayFailure(currentProxy: string): Promise<boolean> {
  try {
    const { getRecentCursorProbe, runCursorApiProbeCheck } = await import(
      './networkStabilityMonitor'
    )
    const recent = getRecentCursorProbe()
    if (recent?.ok && recent.proxyNode === currentProxy) {
      appendAppLog(
        `[ProxyHealthMonitor]: delay unhealthy but recent Cursor API probe ok, keeping "${currentProxy}"\n`
      )
      return true
    }

    const probeOk = await runCursorApiProbeCheck()
    if (probeOk) {
      appendAppLog(
        `[ProxyHealthMonitor]: delay unhealthy but live Cursor API probe ok, keeping "${currentProxy}"\n`
      )
      return true
    }
  } catch (error) {
    appendAppLog(
      `[ProxyHealthMonitor]: Cursor API probe guard failed: ${formatError(error)}\n`
    )
  }

  return false
}

async function runFailoverCheck(trigger: string): Promise<boolean> {
  const appConfig = await getAppConfig()
  const { proxyTimeoutThreshold = 5000, proxySwitchPriority = [] } = appConfig
  const priorityList = normalizePriorityList(proxySwitchPriority)

  const groups = await mihomoGroups()
  if (!groups || groups.length === 0) return false

  const firstGroup = getPrimaryProxyGroup(groups)
  if (!firstGroup?.now || !isRoutingProxyName(firstGroup.now)) {
    return false
  }

  const currentProxy = firstGroup.now
  const reason: SelectionReason = trigger.includes('probe') ? 'cursor-probe' : 'unhealthy'

  if (reason === 'unhealthy' && (await shouldKeepProxyDespiteDelayFailure(currentProxy))) {
    return false
  }

  return applyPrioritySelection(
    firstGroup,
    priorityList,
    currentProxy,
    proxyTimeoutThreshold,
    reason
  )
}

type SelectionReason = 'disallowed-region' | 'unhealthy' | 'cursor-probe' | 'blocked-region'

async function applyPrioritySelection(
  group: ControllerMixedGroup,
  priorityList: string[],
  currentProxyName: string,
  proxyTimeoutThreshold: number,
  reason: SelectionReason
): Promise<boolean> {
  appendAppLog(`[ProxyHealthMonitor]: failover selection started (${reason}), group=${group.name}\n`)

  const currentGroups = await mihomoGroups()
  const freshGroup = currentGroups?.find((g) => g.name === group.name)
  if (!freshGroup) {
    appendAppLog(`[ProxyHealthMonitor]: proxy group "${group.name}" not found\n`)
    return false
  }

  const allowedProxies = freshGroup.all.filter(
    (proxy) => isRoutingProxy(proxy) && isAllowedRegionProxy(proxy.name, priorityList)
  )

  await measureAllowedProxies(allowedProxies)

  const availableProxies = allowedProxies.filter((proxy) => {
    const delay = getProxyDelay(proxy)
    return delay > 0 && delay <= proxyTimeoutThreshold
  })

  const selectedProxy = selectProxyByPriority(availableProxies, priorityList)

  if (selectedProxy) {
    if (selectedProxy.name === currentProxyName) {
      appendAppLog(
        `[ProxyHealthMonitor]: no better node (${reason}), keeping "${currentProxyName}"\n`
      )
      return false
    }

    await mihomoChangeProxy(freshGroup.name, selectedProxy.name)
    const selectedDelay = getProxyDelay(selectedProxy)
    const reasonLabel =
      reason === 'disallowed-region' || reason === 'blocked-region'
        ? 'region restricted'
        : reason === 'cursor-probe'
          ? 'Cursor API probe failed'
          : 'node unhealthy'
    appendAppLog(
      `[ProxyHealthMonitor]: [${reasonLabel}] switched to "${selectedProxy.name}"\n`
    )
    void recordProxySwitch(currentProxyName, selectedProxy.name)
    void showNotification({
      title: 'Proxy switched (failover)',
      body: `${currentProxyName} → ${selectedProxy.name} (${selectedDelay}ms)`,
      variant: 'warning'
    })

    getMainWindow()?.webContents.send('groupsUpdated')
    return true
  }

  appendAppLog('[ProxyHealthMonitor]: no available SG/TW/JP proxy found\n')
  try {
    const { current, items } = await getProfileConfig()
    const currentItem = items.find((item) => item.id === current)
    if (currentItem && currentItem.type === 'remote') {
      appendAppLog('[ProxyHealthMonitor]: refreshing remote subscription as last resort\n')
      await addProfileItem(currentItem)
    } else {
      appendAppLog('[ProxyHealthMonitor]: profile is not remote, cannot refresh subscription\n')
    }
  } catch (e) {
    appendAppLog(`[ProxyHealthMonitor]: subscription refresh failed: ${e}\n`)
  }
  return false
}

function getProxyDelay(proxy: ControllerProxiesDetail | ControllerGroupDetail): number {
  if (!proxy.history || proxy.history.length === 0) return -1
  return proxy.history[proxy.history.length - 1].delay
}

async function measureAllowedProxies(
  proxies: (ControllerProxiesDetail | ControllerGroupDetail)[]
): Promise<void> {
  const concurrency = 10
  const executing = new Set<Promise<void>>()
  const results: Promise<void>[] = []

  for (const proxy of proxies) {
    const p = (async () => {
      try {
        const result = await mihomoProxyDelay(proxy.name)
        const delay = result.delay ?? 0
        proxy.history = [{ time: new Date().toISOString(), delay }]
      } catch {
        proxy.history = [{ time: new Date().toISOString(), delay: 0 }]
      }
    })()
    results.push(p)
    executing.add(p)

    p.finally(() => executing.delete(p))

    if (executing.size >= concurrency) {
      await Promise.race(executing)
    }
  }

  await Promise.allSettled(results)
}

function extractPriorityKeywords(priority: string): string[] {
  const keywords = new Set<string>()
  const chineseSegments = priority.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const segment of chineseSegments) {
    keywords.add(segment.toLowerCase())
  }

  const lower = priority.toLowerCase()
  const latinKeywords = ['singapore', 'taiwan', 'japan', 'sg', 'tw', 'jp']
  for (const keyword of latinKeywords) {
    if (lower.includes(keyword)) {
      keywords.add(keyword)
    }
  }

  return [...keywords]
}

function proxyMatchesPriority(proxyName: string, priority: string): boolean {
  const normalizedProxyName = proxyName.toLowerCase()
  const keywords = extractPriorityKeywords(priority)

  if (keywords.length === 0) {
    const normalizedPriority = priority.toLowerCase()
    return (
      normalizedProxyName.includes(normalizedPriority) ||
      normalizedPriority.includes(normalizedProxyName)
    )
  }

  return keywords.some((keyword) => normalizedProxyName.includes(keyword))
}

function selectProxyByPriority(
  availableProxies: (ControllerProxiesDetail | ControllerGroupDetail)[],
  priorityList: string[]
): ControllerProxiesDetail | ControllerGroupDetail | null {
  for (const priority of priorityList) {
    const matchedProxies = availableProxies.filter((proxy) =>
      proxyMatchesPriority(proxy.name, priority)
    )

    if (matchedProxies.length > 0) {
      return pickLowestDelayProxy(matchedProxies)
    }
  }

  return null
}

function pickLowestDelayProxy(
  proxies: (ControllerProxiesDetail | ControllerGroupDetail)[]
): ControllerProxiesDetail | ControllerGroupDetail {
  return proxies.reduce((best, current) => {
    const bestDelay = getProxyDelay(best)
    const currentDelay = getProxyDelay(current)
    if (currentDelay < bestDelay) return current
    if (currentDelay > bestDelay) return best
    return current.name.localeCompare(best.name) < 0 ? current : best
  })
}
