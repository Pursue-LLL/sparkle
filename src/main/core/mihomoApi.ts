// [INPUT] factory::getRuntimeConfig/loadRuntimeConfigFromDisk (POS: runtime 配置生成/落盘) ·
//         service/api (POS: service 模式签名请求) · mihomo unix socket / controller ·
//         autoSelectStickyPin::notifyAutoSelectUnfixed (POS: `自动选择` 粘性固定) ·
//         config::getAppConfig/getControledMihomoConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorDedicatedManualOnlyCore::isCursorDedicatedManualOnlySwitchAllowed/formatCursorDedicatedManualOnlyBlockedLogLine (POS: Cursor 专用组仅手动切换判定) ·
//         cursorDedicatedSelectionCore::writeCursorDedicatedManualSelection (POS: Cursor 专用组手选持久化) ·
//         cursorProxyGroup::DEFAULT_GENERAL_DELAY_TEST_URL/isCursorSelectorGroupName (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoGroupMembersCore::buildProviderProxyLookup/resolveGroupMemberProxies (POS: 分组成员解析) ·
//         mihomoProbeCoordinator::withMihomoDelayProbeSlot (POS: 全局 delay 并发槽) ·
//         mihomoProxyDelayCore::isMihomoApiResourceNotFoundError/resolveProviderNameForLeaf (POS: 节点延迟探测判定) ·
//         utils/dirs::mihomoIpcPath/serviceIpcPath (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志)
// [OUTPUT] mihomo REST 封装 · mihomoGetConnections · mihomoGroupDetail · mihomoChangeProxy/mihomoUnfixedProxy · delay/provider 单点拨测 ·
//          mihomoStreams 数据流（traffic/memory/logs/connections/alerts）的统一出口
// [POS] mihomo 控制器访问层：统一封装 REST、延迟探测与选点/解固定操作；WebSocket 数据流实现在 mihomoStreams，由此统一对外导出。

import axios, { AxiosInstance } from 'axios'
import { getAppConfig, getControledMihomoConfig } from '../config'
import {
  getRuntimeConfig,
  hydrateRuntimeConfigFromDiskIfEmpty,
  loadRuntimeConfigFromDisk
} from './factory'
import { mihomoIpcPath, serviceIpcPath } from '../utils/dirs'
import { createSignedServiceAxios } from '../service/api'
import { DEFAULT_GENERAL_DELAY_TEST_URL } from './cursorProxyGroup'
import { withMihomoDelayProbeSlot } from './mihomoProbeCoordinator'
import { buildProviderProxyLookup, resolveGroupMemberProxies } from './mihomoGroupMembersCore'
import {
  isMihomoApiResourceNotFoundError,
  resolveProviderNameForLeaf
} from './mihomoProxyDelayCore'

export {
  restartMihomoConnections,
  restartMihomoLogs,
  startMihomoConnections,
  startMihomoLogs,
  startMihomoMemory,
  startMihomoTraffic,
  stopMihomoConnections,
  stopMihomoLogs,
  stopMihomoMemory,
  stopMihomoTraffic,
  subscribeMihomoAlerts,
  subscribeMihomoLogs
} from './mihomoStreams'

export type MihomoChangeProxySource = 'auto' | 'manual' | 'bootstrap'

export interface MihomoChangeProxyOptions {
  /** Cursor 专用组仅接受 manual / 首次 bootstrap 默认值。Default: auto. */
  source?: MihomoChangeProxySource
}

let axiosIns: AxiosInstance = null!
let axiosMode: 'direct' | 'service' | null = null

export const getAxios = async (force: boolean = false): Promise<AxiosInstance> => {
  const { corePermissionMode = 'elevated' } = await getAppConfig()
  const nextMode = corePermissionMode === 'service' ? 'service' : 'direct'
  const currentSocketPath = nextMode === 'service' ? serviceIpcPath() : mihomoIpcPath()
  const currentBaseURL =
    nextMode === 'service' ? 'http://localhost/core/controller' : 'http://localhost'

  if (
    axiosIns &&
    (axiosIns.defaults.socketPath !== currentSocketPath ||
      axiosIns.defaults.baseURL !== currentBaseURL ||
      axiosMode !== nextMode)
  ) {
    force = true
  }

  if (axiosIns && !force) return axiosIns

  axiosMode = nextMode
  if (nextMode === 'service') {
    axiosIns = createSignedServiceAxios(currentBaseURL)
  } else {
    axiosIns = axios.create({
      baseURL: currentBaseURL,
      socketPath: currentSocketPath,
      timeout: 15000
    })

    axiosIns.interceptors.response.use(
      (response) => {
        return response.data
      },
      (error) => {
        if (error.response && error.response.data) {
          return Promise.reject(error.response.data)
        }
        return Promise.reject(error)
      }
    )
  }
  return axiosIns
}

export async function mihomoVersion(): Promise<ControllerVersion> {
  const instance = await getAxios()
  return await instance.get('/version')
}

export const mihomoConfig = async (): Promise<ControllerConfigs> => {
  const instance = await getAxios()
  return await instance.get('/configs')
}

export const patchMihomoConfig = async (patch: Partial<ControllerConfigs>): Promise<void> => {
  const instance = await getAxios()
  return await instance.patch('/configs', patch)
}

/** Reload mihomo runtime config from on-disk work/config.yaml (non-destructive vs restartCore). */
export const reloadMihomoConfigFromDisk = async (): Promise<void> => {
  const instance = await getAxios()
  await instance.put('/configs?force=true', { path: '', payload: '' }, { timeout: 30_000 })
}

export const mihomoCloseConnection = async (id: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete(`/connections/${encodeURIComponent(id)}`)
}

export const mihomoGetConnections = async (): Promise<ControllerConnections> => {
  const instance = await getAxios()
  return await instance.get('/connections')
}

/** Clear in-memory and persisted store-fake-ip mapping (mihomo POST /cache/fakeip/flush). */
export const mihomoFlushFakeIpCache = async (): Promise<void> => {
  const instance = await getAxios()
  await instance.post('/cache/fakeip/flush')
}

export const mihomoCloseConnections = async (name?: string): Promise<void> => {
  const instance = await getAxios()
  if (name) {
    const connectionsInfo = await mihomoGetConnections()
    const targetConnections =
      connectionsInfo?.connections?.filter((conn) => conn.chains && conn.chains.includes(name)) ||
      []
    for (const conn of targetConnections) {
      try {
        await mihomoCloseConnection(conn.id)
      } catch (error) {
        // ignore
      }
    }
  } else {
    return await instance.delete('/connections')
  }
}

export const mihomoRules = async (): Promise<ControllerRules> => {
  const instance = await getAxios()
  return await instance.get('/rules')
}

export const mihomoProxies = async (): Promise<ControllerProxies> => {
  const instance = await getAxios()
  return await instance.get('/proxies')
}

export const mihomoGroups = async (): Promise<ControllerMixedGroup[]> => {
  const { mode = 'rule' } = await getControledMihomoConfig()
  if (mode === 'direct') return []
  const proxies = await mihomoProxies()
  let providerLookup = buildProviderProxyLookup(null)
  try {
    providerLookup = buildProviderProxyLookup(await mihomoProxyProviders())
  } catch {
    // Provider API unavailable — fall back to /proxies-only resolution.
  }
  const resolveMembers = (memberNames: string[]) =>
    resolveGroupMemberProxies(memberNames, proxies.proxies, providerLookup)
  const runtime = await getRuntimeConfig()
  let runtimeGroupDefs =
    (runtime?.['proxy-groups'] as { name: string; url?: string }[] | undefined) ?? []
  if (runtimeGroupDefs.length === 0) {
    const diskRuntime = await loadRuntimeConfigFromDisk()
    runtimeGroupDefs =
      (diskRuntime?.['proxy-groups'] as { name: string; url?: string }[] | undefined) ?? []
    if (runtimeGroupDefs.length > 0) {
      await hydrateRuntimeConfigFromDiskIfEmpty()
    }
  }
  const groups: ControllerMixedGroup[] = []
  runtimeGroupDefs.forEach((group: { name: string; url?: string }) => {
    const { name, url } = group
    if (proxies.proxies[name] && 'all' in proxies.proxies[name] && !proxies.proxies[name].hidden) {
      const newGroup = proxies.proxies[name]
      newGroup.testUrl = url
      const newAll = resolveMembers(newGroup.all)
      groups.push({ ...newGroup, all: newAll })
    }
  })
  if (!groups.find((group) => group.name === 'GLOBAL')) {
    const newGlobal = proxies.proxies['GLOBAL'] as ControllerGroupDetail
    if (!newGlobal.hidden) {
      const newAll = resolveMembers(newGlobal.all)
      groups.push({ ...newGlobal, all: newAll })
    }
  }
  if (mode === 'global') {
    // GLOBAL 被隐藏时找不到（-1），splice(-1) 会把最后一个无关的组挪到最前面
    const global = groups.findIndex((group) => group.name === 'GLOBAL')
    if (global > 0) {
      groups.unshift(groups.splice(global, 1)[0])
    }
  }
  return groups
}

export const mihomoProxyProviders = async (): Promise<ControllerProxyProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/proxies')
}

export const mihomoUpdateProxyProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/proxies/${encodeURIComponent(name)}`)
}

export const mihomoRuleProviders = async (): Promise<ControllerRuleProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/rules')
}

export const mihomoUpdateRuleProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/rules/${encodeURIComponent(name)}`)
}

export const mihomoChangeProxy = async (
  group: string,
  proxy: string,
  options: MihomoChangeProxyOptions = {}
): Promise<boolean> => {
  const source = options.source ?? 'auto'

  const { isCursorSelectorGroupName } = await import('./cursorProxyGroup')
  const isCursorGroup = isCursorSelectorGroupName(group)
  if (isCursorGroup) {
    const groups = await mihomoGroups()
    const targetGroup = groups?.find((item) => item.name === group)
    const current = targetGroup?.now ?? ''
    const {
      isCursorDedicatedManualOnlySwitchAllowed,
      formatCursorDedicatedManualOnlyBlockedLogLine
    } = await import('./cursorDedicatedManualOnlyCore')
    if (
      current &&
      current !== proxy &&
      !isCursorDedicatedManualOnlySwitchAllowed({
        source,
        fromNode: current
      })
    ) {
      const { appendAppLog } = await import('../utils/log')
      await appendAppLog(
        formatCursorDedicatedManualOnlyBlockedLogLine({
          source,
          fromNode: current,
          toNode: proxy
        })
      )
      return false
    }
  }

  const instance = await getAxios()
  await instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy })

  if (source === 'manual' && isCursorGroup) {
    const { writeCursorDedicatedManualSelection } = await import('./cursorDedicatedSelectionCore')
    await writeCursorDedicatedManualSelection(proxy)
  }

  return true
}

export const mihomoUnfixedProxy = async (group: string): Promise<ControllerProxiesDetail> => {
  const { notifyAutoSelectUnfixed } = await import('./autoSelectStickyPin')
  notifyAutoSelectUnfixed(group)
  const instance = await getAxios()
  return await instance.delete(`/proxies/${encodeURIComponent(group)}`)
}

/** 单个代理组的当前状态（now / fixed / all），比 `/proxies` 全量轻。 */
export const mihomoGroupDetail = async (group: string): Promise<ControllerGroupDetail> => {
  const instance = await getAxios()
  return await instance.get(`/proxies/${encodeURIComponent(group)}`)
}

const DEFAULT_DELAY_TEST_TIMEOUT_MS = 10000

export interface MihomoDelayOptions {
  timeoutMs?: number
  /** 期望的 HTTP 状态码（如 '200'）；用于把 403 挑战页判为不可用，未传则不校验状态。 */
  expectedStatus?: string
}

async function resolveDelayTestTimeoutMs(
  appTimeoutMs: number | undefined,
  overrideMs: number | undefined
): Promise<number> {
  if (Number.isFinite(overrideMs) && overrideMs! > 0) {
    return Math.floor(overrideMs!)
  }
  if (Number.isFinite(appTimeoutMs) && appTimeoutMs! > 0) {
    return Math.floor(appTimeoutMs!)
  }
  return DEFAULT_DELAY_TEST_TIMEOUT_MS
}

/**
 * provider 叶子节点不在 `/proxies` 里，只能走 provider 的单点端点。
 * 只拨测这一个节点：不触发整个 provider 的体检，也不重载 provider（二者都会清空/污染其余节点的样本）。
 * 拨测失败时 mihomo 返回错误，原样抛给调用方。
 */
export async function mihomoProviderLeafDelay(
  providerName: string,
  proxy: string,
  url: string,
  timeoutMs: number,
  expectedStatus?: string
): Promise<ControllerProxiesDelay> {
  const instance = await getAxios()
  return await instance.get(
    `/providers/proxies/${encodeURIComponent(providerName)}/${encodeURIComponent(proxy)}/healthcheck`,
    {
      params: {
        url,
        timeout: timeoutMs,
        ...(expectedStatus ? { expected: expectedStatus } : {})
      }
    }
  )
}

async function mihomoProxyDelayUnchecked(
  proxy: string,
  url?: string,
  options?: MihomoDelayOptions
): Promise<ControllerProxiesDelay> {
  const { delayTestUrl, delayTestTimeout } = await getAppConfig()
  const timeoutMs = await resolveDelayTestTimeoutMs(delayTestTimeout, options?.timeoutMs)
  const probeUrl = url || delayTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL
  const instance = await getAxios()
  try {
    return await instance.get(`/proxies/${encodeURIComponent(proxy)}/delay`, {
      params: {
        url: probeUrl,
        timeout: timeoutMs,
        ...(options?.expectedStatus ? { expected: options.expectedStatus } : {})
      }
    })
  } catch (error) {
    const proxies = await mihomoProxies()
    if (!isMihomoApiResourceNotFoundError(error) && proxies.proxies[proxy]) {
      throw error
    }
    const providerName = resolveProviderNameForLeaf(await mihomoProxyProviders(), proxy)
    if (!providerName) {
      throw error
    }
    return await mihomoProviderLeafDelay(
      providerName,
      proxy,
      probeUrl,
      timeoutMs,
      options?.expectedStatus
    )
  }
}

export const mihomoProxyDelay = async (
  proxy: string,
  url?: string,
  options?: MihomoDelayOptions
): Promise<ControllerProxiesDelay> => {
  return withMihomoDelayProbeSlot(() => mihomoProxyDelayUnchecked(proxy, url, options))
}

async function mihomoGroupDelayUnchecked(
  group: string,
  url?: string,
  options?: MihomoDelayOptions
): Promise<ControllerGroupDelay> {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const timeoutMs = await resolveDelayTestTimeoutMs(delayTestTimeout, options?.timeoutMs)
  const instance = await getAxios()
  return await instance.get(`/group/${encodeURIComponent(group)}/delay`, {
    params: {
      url: url || delayTestUrl || DEFAULT_GENERAL_DELAY_TEST_URL,
      timeout: timeoutMs,
      ...(options?.expectedStatus ? { expected: options.expectedStatus } : {})
    }
  })
}

export const mihomoGroupDelay = async (
  group: string,
  url?: string,
  options?: MihomoDelayOptions
): Promise<ControllerGroupDelay> => {
  return withMihomoDelayProbeSlot(() => mihomoGroupDelayUnchecked(group, url, options))
}

export const mihomoRulesDisable = async (rules: Record<string, boolean>): Promise<void> => {
  const instance = await getAxios()
  return await instance.patch(`/rules/disable`, rules)
}

export const mihomoUpgrade = async (channel: string): Promise<void> => {
  if (process.platform === 'win32') await patchMihomoConfig({ 'log-level': 'info' })
  const instance = await getAxios()
  return await instance.post(`/upgrade?channel=${encodeURIComponent(channel)}`, undefined, {
    timeout: 90000
  })
}

export const mihomoUpgradeGeo = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade/geo', undefined, { timeout: 90000 })
}

export const mihomoUpgradeUI = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade/ui', undefined, { timeout: 90000 })
}
