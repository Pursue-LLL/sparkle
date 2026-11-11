// [INPUT] sparkleFastDelaySnapshotCore (POS: 延迟快照指纹/覆盖率/序列化) · sparkleFastLatencyOrderCore (POS: 历史折算与迟滞) · sparkleFastProviderCore (POS: provider 排序) · mihomo provider 探测历史 · sparkle-fast-proxies.yaml · proxySwitchPriority
// [OUTPUT] bootstrapSparkleFastLatencyOrder · loadSparkleFastDelaySnapshot · startSparkleFastLatencyOrderLoop
// [POS] 内核就绪后按实测延迟重排 `自动选择` 的节点（地区分段不变，无样本节点全局垫底），并让 mihomo 重读 provider。
// 启动时先看内存成功样本覆盖率；不足再看磁盘 v2 快照（provider 指纹一致且覆盖 ≥80% 才沿用）；仍不足则逐点补测后重排。
// 每轮实测延迟按 v2 落盘；生成配置重写 sparkle-fast 时读取快照，避免订阅刷新后退回「未测延迟」的订阅顺序。
// 文件序只决定「下一次选节点」选谁：`自动选择` 固定（autoSelectStickyPin）后，存活的当前节点不受重排影响。
// 仅启动阶段且原固定节点不在实测存活表内时解除固定；周期复查绝不解除，避免存活节点被换掉。
// 重排会重载 provider 并清空其探测记录，发生重排后立即逐点补测，让 fallback 的存活判断与下一轮排序有新样本。

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
  hasSufficientSnapshotCoverage,
  parseSparkleFastDelaySnapshot,
  serializeSparkleFastDelaySnapshot,
  snapshotCoverage,
  type ProxyRecord
} from './sparkleFastDelaySnapshotCore'
import {
  collectNodeDelays,
  hasSameNodeOrder,
  shouldAdoptLatencyOrder
} from './sparkleFastLatencyOrderCore'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID,
  type NodeDelayMap
} from './sparkleFastProviderCore'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000

const DELAY_SNAPSHOT_FILENAME = 'sparkle-fast-delays.json'

function delaySnapshotPath(): string {
  return path.join(dataDir(), DELAY_SNAPSHOT_FILENAME)
}

/**
 * 读取上一轮实测延迟快照。只有 provider 配置指纹一致时才返回样本；
 * 旧格式、配置变化、文件名漂移都会返回空表，迫使调用方重新探测。
 */
export async function loadSparkleFastDelaySnapshot(
  currentProxies: readonly ProxyRecord[]
): Promise<NodeDelayMap> {
  try {
    const raw = await readFile(delaySnapshotPath(), 'utf8')
    return parseSparkleFastDelaySnapshot(raw, currentProxies)
  } catch {
    return new Map()
  }
}

/** provider 有实测样本时以其为准并写入快照；样本被清空（如 provider 刚重载）时退回快照。 */
async function resolveSparkleFastDelayMap(
  providerProxies: Parameters<typeof collectNodeDelays>[0],
  currentProxies: readonly ProxyRecord[]
): Promise<NodeDelayMap> {
  const fingerprintProxies =
    currentProxies.length > 0 ? currentProxies : (providerProxies as unknown as ProxyRecord[])
  const measured = collectNodeDelays(providerProxies, AUTO_SELECT_GEMINI_PROBE_URL)
  if (measured.size === 0) {
    return loadSparkleFastDelaySnapshot(fingerprintProxies)
  }
  await writeFile(
    delaySnapshotPath(),
    serializeSparkleFastDelaySnapshot(fingerprintProxies, measured),
    'utf8'
  )
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
  const filePath = path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME)
  const current = (parseYaml<{ proxies?: ProxyRecord[] }>(await readFile(filePath, 'utf8'))
    .proxies ?? []) as ProxyRecord[]
  const delays = await resolveSparkleFastDelayMap(provider?.proxies ?? [], current)
  if (delays.size === 0) {
    await appendAppLog('[SparkleFastOrder]: skipped, no probe samples yet\n')
    return false
  }
  const { proxySwitchPriority = [] } = await getAppConfig()
  const { loadGeminiBlockedNodeNames } = await import('./sparkleGeminiProbe')
  const blockedNodeNames = await loadGeminiBlockedNodeNames(current)
  const { proxies: ordered } = buildSparkleFastProviderDocument({
    proxies: current,
    regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
    delayMs: delays,
    blockedNodeNames
  })
  const nextFirst = String(ordered[0]?.name ?? '')
  const sameOrder = hasSameNodeOrder(current, ordered)
  if (
    !force &&
    (sameOrder || !shouldAdoptLatencyOrder(String(current[0]?.name), nextFirst, delays))
  ) {
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

async function readCurrentSparkleFastProxies(): Promise<ProxyRecord[]> {
  try {
    const filePath = path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME)
    const document = parseYaml<{ proxies?: ProxyRecord[] }>(await readFile(filePath, 'utf8'))
    return document.proxies ?? []
  } catch {
    return []
  }
}

/**
 * API 就绪后的启动处理：
 * - 内存里已有 ≥80% Gemini 样本：直接按现有历史重排；
 * - 否则只有磁盘快照与当前 provider 配置指纹一致且覆盖率 ≥80% 时才沿用；
 * - 快照缺失、配置变化或覆盖不足时强制逐点补测，不能拿残缺快照跳过探测。
 */
export async function bootstrapSparkleFastLatencyOrder(): Promise<void> {
  const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
  const providerProxies = provider?.proxies ?? []
  const currentProxies = await readCurrentSparkleFastProxies()
  const fingerprintProxies =
    currentProxies.length > 0 ? currentProxies : (providerProxies as unknown as ProxyRecord[])
  const memorySamples = collectNodeDelays(providerProxies, AUTO_SELECT_GEMINI_PROBE_URL)
  if (!hasSufficientSnapshotCoverage(fingerprintProxies, memorySamples)) {
    const snapshot = await loadSparkleFastDelaySnapshot(fingerprintProxies)
    if (hasSufficientSnapshotCoverage(fingerprintProxies, snapshot)) {
      const coverage = snapshotCoverage(fingerprintProxies, snapshot)
      await releaseAutoSelectPinIfUnhealthy(snapshot)
      await appendAppLog(
        `[SparkleFastOrder]: bootstrap using disk snapshot samples=${snapshot.size} covered=${coverage.covered}/${coverage.total}\n`
      )
      return
    }
    const memoryCoverage = snapshotCoverage(fingerprintProxies, memorySamples)
    const diskCoverage = snapshotCoverage(fingerprintProxies, snapshot)
    await appendAppLog(
      `[SparkleFastOrder]: bootstrap samples insufficient memory=${memorySamples.size} disk=${snapshot.size} covered=${diskCoverage.covered}/${diskCoverage.total} action=probe\n`
    )
    try {
      // 逐点低并发拨测：整个 provider 同时体检会把正常节点测成超时，进而被排到段尾。
      await probeProviderLeavesGently(FAST_NODE_PROVIDER_ID)
    } catch (error) {
      await appendAppLog(
        `[SparkleFastOrder]: probe failed: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
    await appendAppLog(
      `[SparkleFastOrder]: probe complete memory_before=${memoryCoverage.covered}/${memoryCoverage.total}\n`
    )
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
