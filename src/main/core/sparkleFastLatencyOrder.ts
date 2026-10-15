// [INPUT] mihomo provider 探测历史 · sparkle-fast-proxies.yaml · sparkle-fast-delays.json · proxySwitchPriority
// [OUTPUT] bootstrapSparkleFastLatencyOrder · loadSparkleFastDelaySnapshot · startSparkleFastLatencyOrderLoop
// [POS] 内核就绪后按实测延迟重排 `自动选择` 的节点（地区分段不变），并让 mihomo 重读 provider。
// 每轮实测延迟落盘为快照；生成配置重写 sparkle-fast 时读取快照，避免订阅刷新后退回「未测延迟」的订阅顺序。
// 文件序只决定「下一次选节点」选谁：`自动选择` 固定（autoSelectStickyPin）后，存活的当前节点不受重排影响。
// 仅启动阶段解除固定，让重启后按最新延迟序重新选择；周期复查绝不解除，避免存活节点被换掉。
// 启动时先低并发逐点拨测再重排；周期复查仅当新首选明显更快才换文件序。
// 重排会重载 provider 并清空其探测记录，周期重排后立即逐点补测，让 fallback 的存活判断与下一轮排序有新样本。

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { dataDir, profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { AUTO_SELECT_GROUP_NAME, AUTO_SELECT_GEMINI_PROBE_URL } from './defaultAutoSwitchProxy'
import {
  mihomoGroupDetail,
  mihomoProxyProviders,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { probeProviderLeavesGently } from './providerLeafProbe'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  collectNodeDelays,
  hasPreferredUrlSamples,
  hasSameNodeOrder,
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

const DELAY_SNAPSHOT_FILENAME = 'sparkle-fast-delays.json'

function delaySnapshotPath(): string {
  return path.join(dataDir(), DELAY_SNAPSHOT_FILENAME)
}

/** 读取上一轮实测延迟快照；缺失或损坏时视为尚无样本。 */
export async function loadSparkleFastDelaySnapshot(): Promise<NodeDelayMap> {
  try {
    const raw = JSON.parse(await readFile(delaySnapshotPath(), 'utf8')) as Record<string, number>
    return new Map(Object.entries(raw).filter(([, delay]) => Number.isFinite(delay) && delay > 0))
  } catch {
    return new Map()
  }
}

/** provider 有实测样本时以其为准并写入快照；样本被清空（如 provider 刚重载）时退回快照。 */
async function resolveSparkleFastDelayMap(
  providerProxies: Parameters<typeof collectNodeDelays>[0]
): Promise<NodeDelayMap> {
  const measured = collectNodeDelays(providerProxies, AUTO_SELECT_GEMINI_PROBE_URL)
  if (measured.size === 0) {
    return loadSparkleFastDelaySnapshot()
  }
  await writeFile(delaySnapshotPath(), JSON.stringify(Object.fromEntries(measured)), 'utf8')
  return measured
}

/** 仅当 `自动选择` 当前固定节点不在实测存活表内（已死或已移除）时解除固定，避免打断健康节点。 */
async function releaseAutoSelectPinIfUnhealthy(delays: NodeDelayMap): Promise<void> {
  try {
    const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (group.fixed && !delays.has(group.fixed)) {
      await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
    }
  } catch {
    await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
  }
}

async function refillProviderSamplesAfterReorder(): Promise<void> {
  try {
    await probeProviderLeavesGently(FAST_NODE_PROVIDER_ID)
    await appendAppLog('[SparkleFastOrder]: refilled probe samples after reorder\n')
  } catch (error) {
    await appendAppLog(
      `[SparkleFastOrder]: refill failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

/**
 * @param force 启动阶段为 true：无条件采用延迟序；周期复查为 false：需通过迟滞判定。
 * 仅 force 且当前固定节点不存活时解除 `自动选择` 的固定；周期复查保留固定。
 * @returns 是否重排并通知了 mihomo。
 */
async function applyLatencyOrder(force: boolean): Promise<boolean> {
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
  const sameOrder = hasSameNodeOrder(current, ordered)
  if (!force && (sameOrder || !shouldAdoptLatencyOrder(String(current[0]?.name), nextFirst, delays))) {
    return false
  }

  if (!sameOrder) {
    await writeFile(filePath, stringifyYaml({ proxies: ordered }), 'utf8')
    await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
    await appendAppLog(
      `[SparkleFastOrder]: reordered by latency nodes=${ordered.length} sampled=${delays.size} first=${nextFirst}\n`
    )
  }
  if (force) {
    await releaseAutoSelectPinIfUnhealthy(delays)
  }
  return !sameOrder
}

/** API 就绪后先确认有实测 Gemini 样本（冷启动无样本时先低并发拨测），再重排；若重排重载清空了内存样本则补测。 */
export async function bootstrapSparkleFastLatencyOrder(): Promise<void> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  if (!hasPreferredUrlSamples(provider?.proxies ?? [], AUTO_SELECT_GEMINI_PROBE_URL)) {
    try {
      // 逐点低并发拨测：整个 provider 同时体检会把正常节点测成超时，进而被排到段尾。
      await probeProviderLeavesGently(FAST_NODE_PROVIDER_ID)
    } catch (error) {
      await appendAppLog(
        `[SparkleFastOrder]: probe failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  }
  if (await applyLatencyOrder(true)) {
    await refillProviderSamplesAfterReorder()
  }
}

async function recheckSparkleFastLatencyOrder(): Promise<void> {
  if (!(await applyLatencyOrder(false))) {
    return
  }
  await refillProviderSamplesAfterReorder()
}

let refreshTimer: NodeJS.Timeout | undefined

/** 幂等：内核重启后无需重复注册，周期任务在内核不可达时静默跳过本轮。 */
export function startSparkleFastLatencyOrderLoop(): void {
  if (refreshTimer) {
    return
  }
  refreshTimer = setInterval(() => {
    recheckSparkleFastLatencyOrder().catch(() => undefined)
  }, REFRESH_INTERVAL_MS)
  refreshTimer.unref()
}
