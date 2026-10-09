// [INPUT] mihomo provider 探测历史 · sparkle-fast-proxies.yaml · proxySwitchPriority
// [OUTPUT] refreshSparkleFastLatencyOrder
// [POS] 内核就绪后按实测延迟重排 `自动选择` 的节点（地区分段不变），并让 mihomo 重读 provider。
// 启动时无条件按延迟重排；之后每 {@link REFRESH_INTERVAL_MS} 周期复查，仅当新首选明显更快才换，
// fallback 仍只在首选挂掉时切换，不因延迟抖动来回切。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import { mihomoProxyProviders, mihomoUpdateProxyProviders } from './mihomoApi'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  collectNodeDelays,
  hasSameNodeOrder,
  shouldAdoptLatencyOrder
} from './sparkleFastLatencyOrderCore'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID
} from './sparkleFastProviderCore'

type ProxyRecord = Record<string, unknown>

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

/**
 * @param force 启动阶段为 true：无条件采用延迟序；周期复查为 false：需通过迟滞判定。
 * @returns 是否重排并通知了 mihomo。
 */
export async function refreshSparkleFastLatencyOrder(force: boolean): Promise<boolean> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  const delays = collectNodeDelays(provider?.proxies ?? [], AUTO_SELECT_GEMINI_PROBE_URL)
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
  if (hasSameNodeOrder(current, ordered)) {
    return false
  }
  if (
    !force &&
    !shouldAdoptLatencyOrder(String(current[0]?.name), String(ordered[0]?.name), delays)
  ) {
    return false
  }

  await writeFile(filePath, stringifyYaml({ proxies: ordered }), 'utf8')
  await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
  await appendAppLog(
    `[SparkleFastOrder]: reordered by latency nodes=${ordered.length} sampled=${delays.size} first=${String(ordered[0]?.name)}\n`
  )
  return true
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
