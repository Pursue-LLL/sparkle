// [INPUT] mihomo provider 探测历史 · api2-probe-ledger · sparkle-fast-proxies.yaml · proxySwitchPriority
// [OUTPUT] bootstrapSparkleFastLatencyOrder · refreshSparkleFastLatencyOrder · startSparkleFastLatencyOrderLoop
// [POS] 内核就绪后按实测延迟重排 `自动选择` 的节点（地区分段不变），并让 mihomo 重读 provider。
// 生成配置时先用 ledger 延迟写 sparkle-fast，避免冷启动在「未测延迟」时盲选订阅顺序第一个。
// 不固定（pin）`自动选择`：fallback 本就取文件序里第一个存活节点，固定反而会盖过文件序并写入 store-selected。
// 启动时先 healthcheck 再重排；周期复查仅当新首选明显更快才换文件序。
// fallback 仍只在当前节点挂掉时切换，不因延迟抖动来回切。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { readApi2ProbeLedgerSince } from './api2ProbeLedgerCore'
import { AUTO_SELECT_GROUP_NAME, AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import {
  getAxios,
  mihomoProxyProviders,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import {
  buildNodeDelayMapFromLedgerRows,
  LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS
} from './providerDelayHistoryFromLedgerCore'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  collectNodeDelays,
  hasSameNodeOrder,
  mergeNodeDelayMaps,
  shouldAdoptLatencyOrder
} from './sparkleFastLatencyOrderCore'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID,
  type NodeDelayMap
} from './sparkleFastProviderCore'

type ProxyRecord = Record<string, unknown>

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

export async function loadSparkleFastLedgerDelayMap(): Promise<NodeDelayMap> {
  const sinceMs = Date.now() - LEDGER_PROVIDER_DELAY_HISTORY_LOOKBACK_MS
  const rows = await readApi2ProbeLedgerSince(sinceMs, 'active')
  return buildNodeDelayMapFromLedgerRows(rows)
}

async function resolveSparkleFastDelayMap(
  providerProxies: Parameters<typeof collectNodeDelays>[0]
): Promise<NodeDelayMap> {
  const fromProvider = collectNodeDelays(providerProxies, AUTO_SELECT_GEMINI_PROBE_URL)
  if (fromProvider.size > 0) {
    return mergeNodeDelayMaps(fromProvider, await loadSparkleFastLedgerDelayMap())
  }
  return loadSparkleFastLedgerDelayMap()
}

/** 清除 `自动选择` 的固定节点，让 fallback 回到「文件序第一个存活节点」。 */
async function releaseAutoSelectPin(): Promise<void> {
  await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
}

/**
 * @param force 启动阶段为 true：无条件采用延迟序；周期复查为 false：需通过迟滞判定。
 * 采用新序后解除 `自动选择` 的固定，由 fallback 直接取新序第一个存活节点。
 * @returns 是否重排并通知了 mihomo。
 */
export async function refreshSparkleFastLatencyOrder(force: boolean): Promise<boolean> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  const delays = await resolveSparkleFastDelayMap(provider?.proxies ?? [])
  if (delays.size === 0) {
    await appendAppLog('[SparkleFastOrder]: skipped, no probe samples yet\n')
    return false
  }

  const filePath = path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME)
  const current = (parseYaml<{ proxies?: ProxyRecord[] }>(await readFile(filePath, 'utf8'))
    .proxies ?? []) as ProxyRecord[]
  const { proxySwitchPriority = [] } = await getAppConfig()
  const { proxies: ordered } = buildSparkleFastProviderDocument({
    proxies: current,
    regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
    delayMs: delays
  })
  const nextFirst = String(ordered[0]?.name ?? '')
  if (hasSameNodeOrder(current, ordered)) {
    if (force) {
      await releaseAutoSelectPin()
    }
    return false
  }
  if (
    !force &&
    !shouldAdoptLatencyOrder(String(current[0]?.name), nextFirst, delays)
  ) {
    return false
  }

  await writeFile(filePath, stringifyYaml({ proxies: ordered }), 'utf8')
  await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
  await releaseAutoSelectPin()
  await appendAppLog(
    `[SparkleFastOrder]: reordered by latency nodes=${ordered.length} sampled=${delays.size} first=${nextFirst}\n`
  )
  return true
}

/** API 就绪后立即探测并重排，避免 fallback 长时间停在订阅顺序第一个。 */
export async function bootstrapSparkleFastLatencyOrder(): Promise<void> {
  if (await refreshSparkleFastLatencyOrder(true)) {
    return
  }
  try {
    // sparkle-fast 节点多，默认 15s axios 超时会在探测完成前断开。
    const instance = await getAxios()
    await instance.get(`/providers/proxies/${encodeURIComponent(FAST_NODE_PROVIDER_ID)}/healthcheck`, {
      timeout: 120_000
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000)
    })
  } catch (error) {
    await appendAppLog(
      `[SparkleFastOrder]: healthcheck failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
  await refreshSparkleFastLatencyOrder(true)
}

let refreshTimer: NodeJS.Timeout | undefined

/** 幂等：内核重启后无需重复注册，周期任务在内核不可达时静默跳过本轮。 */
export function startSparkleFastLatencyOrderLoop(): void {
  if (refreshTimer) {
    return
  }
  refreshTimer = setInterval(() => {
    refreshSparkleFastLatencyOrder(false).catch(() => undefined)
  }, REFRESH_INTERVAL_MS)
  refreshTimer.unref()
}
