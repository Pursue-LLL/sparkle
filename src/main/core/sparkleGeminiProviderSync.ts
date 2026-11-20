// [INPUT] config::getAppConfig/getProfile/getProfileConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         mihomoApi::mihomoCloseConnections/mihomoProxyProviders/mihomoUpdateProxyProviders (POS: mihomo 控制器访问层) ·
//         provider::extractProxies (POS: 订阅节点 → provider 文件) ·
//         regionPriority::resolveEffectiveRegionPriority (POS: 地区优先级与地区匹配) ·
//         sparkleFastLatencyOrder::loadSparkleFastDelaySnapshot (POS: sparkle-fast 延迟序运行时) ·
//         sparkleGeminiProbeCore::resolveGeminiBlockedNodeNames (POS: Gemini 地区判定纯函数) ·
//         sparkleGeminiProviderCore::buildSparkleGeminiProviderDocument/geminiHeadUpgradeAvailable/geminiProviderMembershipChanged/GEMINI_NODE_PROVIDER_FILENAME/GEMINI_NODE_PROVIDER_ID (POS: gemini provider 与分组配置) ·
//         sparkleGeminiRegionCache::loadSparkleGeminiRegionCache (POS: Gemini 地区判定缓存) ·
//         sparkleGeminiStabilityCore::isNodeStable (POS: Gemini 节点稳定度台账的纯规则) ·
//         sparkleGeminiStabilityStore::loadGeminiStabilityLedger (POS: Gemini 节点稳定度台账) ·
//         sparkleMailProviderCore::MailProxyRecord (POS: 邮件 provider 与分组配置) ·
//         utils/dirs::profilesDir (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化)
// [OUTPUT] resolveCurrentProfileProxies · rebuildAndReloadGeminiProvider
// [POS] `gemini专用` provider 与地区缓存、稳定度台账的对账：按当前判定重建 provider 文件并热重载。
// 只有成员集合增删、或队首从不稳定节点升级成稳定节点时才写盘 + `PUT /providers/proxies`，其余顺序与延迟变化不打断已建立的连接；
// 因被判封锁而出池的节点，同时断开它名下经本组的连接（mihomo 重载 provider 只影响新连接，长连接会一直留在坏出口上）；
// 容量挤出与记录过期造成的出池不断连，免得打断正在流式输出的回答；多处触发的重建排队串行执行，不会互相覆盖。

import { writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig, getProfile, getProfileConfig } from '../config'
import { profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { GEMINI_DEDICATED_GROUP_NAME } from './cursorProxyGroup'
import {
  mihomoCloseConnections,
  mihomoProxyProviders,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { extractProxies } from './provider'
import { resolveEffectiveRegionPriority } from './regionPriority'
import { resolveGeminiBlockedNodeNames } from './sparkleGeminiProbeCore'
import {
  buildSparkleGeminiProviderDocument,
  GEMINI_NODE_PROVIDER_FILENAME,
  GEMINI_NODE_PROVIDER_ID,
  geminiHeadUpgradeAvailable,
  geminiProviderMembershipChanged
} from './sparkleGeminiProviderCore'
import { loadSparkleGeminiRegionCache } from './sparkleGeminiRegionCache'
import { isNodeStable } from './sparkleGeminiStabilityCore'
import { loadGeminiStabilityLedger } from './sparkleGeminiStabilityStore'
import type { MailProxyRecord } from './sparkleMailProviderCore'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 当前订阅里的节点；没选订阅、配置读不出来或订阅无节点时返回空数组。 */
export async function resolveCurrentProfileProxies(): Promise<MailProxyRecord[]> {
  try {
    const { current } = await getProfileConfig()
    if (!current || current === 'default') {
      return []
    }
    const currentProfile = await getProfile(current)
    return extractProxies(currentProfile) as MailProxyRecord[]
  } catch {
    return []
  }
}

/** 关闭失败不连累已经完成的重载：旧连接最多留到自然结束。 */
async function closeEvictedConnections(nodeName: string): Promise<void> {
  try {
    await mihomoCloseConnections(nodeName, GEMINI_DEDICATED_GROUP_NAME)
    await appendAppLog(
      `[SparkleGeminiProbe]: closed ${GEMINI_DEDICATED_GROUP_NAME} connections of evicted node "${nodeName}"\n`
    )
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: could not close connections of evicted node "${nodeName}": ${describeError(error)}\n`
    )
  }
}

/**
 * 按当前地区缓存与稳定度台账重建 `gemini专用` provider 并热重载：
 * provider 尚未进入运行配置（旧配置）或订阅无节点时静默跳过，文件仍会落盘供下次生成引用。
 */
async function rebuildOnce(): Promise<void> {
  try {
    const proxies = await resolveCurrentProfileProxies()
    if (proxies.length === 0) {
      return
    }
    const { proxySwitchPriority = [] } = await getAppConfig()
    const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
    const [delaySnapshot, regionCache, ledger] = await Promise.all([
      loadSparkleFastDelaySnapshot(proxies),
      loadSparkleGeminiRegionCache(),
      loadGeminiStabilityLedger()
    ])
    const nowMs = Date.now()
    const isStable = (name: string): boolean => isNodeStable(ledger.get(name), nowMs)
    const doc = buildSparkleGeminiProviderDocument({
      proxies,
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
      regionCache,
      delayMs: delaySnapshot,
      stability: { ledger, nowMs }
    })
    if (doc.proxies.length === 0) {
      return
    }
    const nextNames = doc.proxies.map((proxy) => String(proxy.name ?? '').trim())
    const providerFile = path.join(profilesDir(), GEMINI_NODE_PROVIDER_FILENAME)
    const provider = (await mihomoProxyProviders()).providers[GEMINI_NODE_PROVIDER_ID]
    if (!provider) {
      await writeFile(providerFile, stringifyYaml(doc), 'utf8')
      return
    }
    const currentNames = (provider.proxies ?? []).map((leaf) => leaf.name)
    if (
      !geminiProviderMembershipChanged(currentNames, nextNames) &&
      !geminiHeadUpgradeAvailable(currentNames, nextNames, isStable)
    ) {
      return
    }
    await writeFile(providerFile, stringifyYaml(doc), 'utf8')
    await mihomoUpdateProxyProviders(GEMINI_NODE_PROVIDER_ID)

    const stableCount = nextNames.filter(isStable).length
    await appendAppLog(
      `[SparkleGeminiProbe]: gemini provider reloaded members=${nextNames.length} stable=${stableCount} first=${nextNames[0]}${stableCount === 0 ? ' degraded=no-stable-node' : ''}\n`
    )

    const kept = new Set(nextNames)
    const blocked = resolveGeminiBlockedNodeNames(proxies, regionCache)
    for (const name of currentNames) {
      if (!kept.has(name) && blocked.has(name)) {
        await closeEvictedConnections(name)
      }
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: rebuild gemini provider failed: ${describeError(error)}\n`
    )
  }
}

let rebuildQueue: Promise<void> = Promise.resolve()

/**
 * 重建串行执行：审计收尾与队首守护都会触发，并发时各自读 provider、各自写文件，
 * 后写的一份可能是基于旧判定算出来的；排队后每一次都读到上一次已经重载完的状态。
 * 队列尾部吞掉异常，某一次重建彻底失败（连失败日志都写不出）也不会挡住后面的重建。
 */
export function rebuildAndReloadGeminiProvider(): Promise<void> {
  const run = rebuildQueue.then(rebuildOnce)
  rebuildQueue = run.catch(() => undefined)
  return run
}
