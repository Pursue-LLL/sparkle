// [INPUT] localProbeChannel::withLocalProbeChannelLock (POS: 本地隐藏探测监听器串行化入口) ·
//         sparkleGeminiStreamProbe::streamProbeGeminiRegionViaLocalListener (POS: 流式地区探测) · 当前订阅节点 ·
//         config::getAppConfig (POS: 应用 / 内核 / 订阅 / 覆写配置读写) ·
//         cursorProxyGroup::AUTO_SELECT_GROUP_NAME (POS: Sparkle 分组名常量与判定谓词) ·
//         defaultAutoSwitchProxy::AUTO_SELECT_DELAY_PROBE_URL (POS: 自动选择与地区组默认配置) ·
//         mihomoApi::mihomoGroupDetail/mihomoProxyProviders/mihomoUnfixedProxy/mihomoUpdateProxyProviders (POS: mihomo 控制器访问层) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         regionPriority::resolveEffectiveRegionPriority (POS: 地区优先级与地区匹配) ·
//         sparkleFastLatencyOrder::loadSparkleFastDelaySnapshot (POS: sparkle-fast 延迟序运行时) ·
//         sparkleFastProviderCore::buildSparkleFastProviderDocument/FAST_NODE_PROVIDER_FILENAME/FAST_NODE_PROVIDER_ID (POS: sparkle-fast provider 文件生成) ·
//         sparkleFastProviderExclusions::loadFastProviderExclusions (POS: sparkle-fast 剔除/沉底依据) ·
//         sparkleGeminiProbeCore::lookupGeminiRegionRecord/resolveGeminiBlockedNodeNames/GeminiRegionProbeRecord (POS: Gemini 地区判定纯函数) ·
//         sparkleGeminiProviderSync::rebuildAndReloadGeminiProvider/resolveCurrentProfileProxies (POS: gemini专用 provider 与判定的对账) ·
//         sparkleGeminiRegionCache::ELIGIBLE_CACHE_TTL_MS/loadSparkleGeminiRegionCache/saveSparkleGeminiRegionCache (POS: Gemini 地区判定缓存) ·
//         sparkleGeminiStabilityStore::noteGeminiRegionSample (POS: Gemini 节点稳定度台账) ·
//         sparkleMailProviderCore::MailProxyRecord (POS: 邮件 provider 与分组配置) ·
//         utils/dirs::profilesDir (POS: 应用目录与路径常量) ·
//         utils/log::appendAppLog (POS: 应用日志与内核日志) ·
//         utils/yaml::stringifyYaml (POS: YAML 解析与序列化) ·
//         dedicatedGroups::runWhenEnabled (POS: 可开关专用组注册表与开关解析)
// [OUTPUT] loadGeminiBlockedNodeNames · verifyNodeGeminiRegion · rebuildAndReloadSparkleFastProvider · bootstrapSparkleGeminiRegionAudit · startSparkleGeminiRegionAuditLoop
// [POS] 识别「HTTP 200 但被 Google GeoIP 判定为送中/不支持地区（如 vXmutd="ZZ"/"CN"/"HK" 或 google.cn）」的节点：
// 确认锁区/送中的节点从 `sparkle-fast-proxies.yaml`（`自动选择`）中剔除，确认解锁的节点维护进 `gemini专用` provider，
// 两条线共用同一份地区缓存与同一轮审计，成员集合变化才热重载；每个明确结论同时记入稳定度台账（判定是概率事件，不是节点属性）。
// 合格记录在过期前就被审计复验（刷新前置），稳定的节点不会因为记录过期而周期性掉出 `gemini专用` 池。
// 网络超时或连接瞬断绝不误判为锁区（仅当明确提取到不支持的地区码时才记入锁区缓存）。
// 后台定时审计经开关门控：`gemini专用` 关闭则整轮跳过、不发任何请求；`自动选择` 挑节点时的按需地区校验（`verifyNodeGeminiRegion`）不经门控，不受开关影响。

import { writeFile } from 'fs/promises'
import path from 'path'
import { getAppConfig } from '../config'
import { profilesDir } from '../utils/dirs'
import { appendAppLog } from '../utils/log'
import { stringifyYaml } from '../utils/yaml'
import { AUTO_SELECT_GROUP_NAME } from './cursorProxyGroup'
import { AUTO_SELECT_DELAY_PROBE_URL } from './defaultAutoSwitchProxy'
import {
  mihomoGroupDetail,
  mihomoProxyProviders,
  mihomoUnfixedProxy,
  mihomoUpdateProxyProviders
} from './mihomoApi'
import { resolveEffectiveRegionPriority } from './regionPriority'
import {
  buildSparkleFastProviderDocument,
  FAST_NODE_PROVIDER_FILENAME,
  FAST_NODE_PROVIDER_ID
} from './sparkleFastProviderCore'
import { loadFastProviderExclusions } from './sparkleFastProviderExclusions'
import {
  lookupGeminiRegionRecord,
  resolveGeminiBlockedNodeNames,
  type GeminiRegionProbeRecord
} from './sparkleGeminiProbeCore'
import {
  rebuildAndReloadGeminiProvider,
  resolveCurrentProfileProxies
} from './sparkleGeminiProviderSync'
import {
  ELIGIBLE_CACHE_TTL_MS,
  loadSparkleGeminiRegionCache,
  saveSparkleGeminiRegionCache
} from './sparkleGeminiRegionCache'
import { noteGeminiRegionSample } from './sparkleGeminiStabilityStore'
import { streamProbeGeminiRegionViaLocalListener } from './sparkleGeminiStreamProbe'
import type { MailProxyRecord } from './sparkleMailProviderCore'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { withLocalProbeChannelLock } from './localProbeChannel'
import { runWhenEnabled, type DedicatedGroupGate } from './dedicatedGroups'

const AUDIT_INTERVAL_MS = 30 * 60 * 1000

/**
 * 合格记录用到只剩两个审计周期（再加 5 分钟余量）就提前复验：
 * 连续错过一轮审计，记录也在过期前被换新，稳定节点不会因为过期被挤出 `gemini专用` 池。
 */
const REFRESH_AFTER_MS = ELIGIBLE_CACHE_TTL_MS - 2 * AUDIT_INTERVAL_MS - 5 * 60 * 1000

export async function loadGeminiBlockedNodeNames(
  proxies?: readonly MailProxyRecord[]
): Promise<Set<string>> {
  const cache = await loadSparkleGeminiRegionCache()
  if (cache.size === 0) {
    return new Set()
  }
  const targetProxies = proxies ?? (await resolveCurrentProfileProxies())
  if (targetProxies.length > 0) {
    return resolveGeminiBlockedNodeNames(targetProxies, cache)
  }
  // 拿不到节点列表（没选订阅、配置读不出来或订阅里没有节点）时，按缓存里记录的节点名兜底。
  const fallback = new Set<string>()
  for (const [key, rec] of cache.entries()) {
    if (!rec.eligible && !key.includes('|')) {
      fallback.add(key)
    }
  }
  if (fallback.size === 0) {
    for (const [key, rec] of cache.entries()) {
      if (!rec.eligible) {
        const parts = key.split('|')
        const name = parts.length >= 4 ? parts.slice(0, -3).join('|') : key
        if (name) fallback.add(name)
      }
    }
  }
  return fallback
}

/** 当新发现锁区/送中节点时，立即重写 `sparkle-fast-proxies.yaml` 并通知 mihomo 热重载。 */
export async function rebuildAndReloadSparkleFastProvider(): Promise<void> {
  try {
    const proxies = await resolveCurrentProfileProxies()
    if (proxies.length === 0) {
      return
    }
    const { proxySwitchPriority = [] } = await getAppConfig()
    const { loadSparkleFastDelaySnapshot } = await import('./sparkleFastLatencyOrder')
    const [delaySnapshot, exclusions] = await Promise.all([
      loadSparkleFastDelaySnapshot(proxies),
      loadFastProviderExclusions(proxies)
    ])
    const doc = buildSparkleFastProviderDocument({
      proxies,
      regionPriority: resolveEffectiveRegionPriority(proxySwitchPriority),
      delayMs: delaySnapshot,
      ...exclusions
    })
    await writeFile(
      path.join(profilesDir(), FAST_NODE_PROVIDER_FILENAME),
      stringifyYaml(doc),
      'utf8'
    )
    await mihomoUpdateProxyProviders(FAST_NODE_PROVIDER_ID)
    const group = await mihomoGroupDetail(AUTO_SELECT_GROUP_NAME)
    if (group.fixed && exclusions.blockedNodeNames.has(group.fixed)) {
      await mihomoUnfixedProxy(AUTO_SELECT_GROUP_NAME)
    }
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: rebuild sparkle-fast failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

/**
 * 校验单个节点是否真正解锁 Gemini 地区限制（非送中/锁区）：
 * - 命中缓存且记录不比 `maxAgeMs` 老（不传则只要没过期）时直接 O(1) 返回；
 * - 否则通过隐藏探测监听器流式检查 `https://gemini.google.com/app` 的 `vXmutd` 地区码，
 *   明确的结论同时记入地区缓存与稳定度台账；
 * - 若确认锁区（如 `ZZ`/`CN`/`HK`），立即记入黑名单并触发 `sparkle-fast` 热重载剔除该节点。
 */
export async function verifyNodeGeminiRegion(
  nodeName: string,
  options?: { skipProviderReloadOnReject?: boolean; maxAgeMs?: number }
): Promise<{ eligible: boolean; countryCode?: string; definitive: boolean }> {
  const trimmed = nodeName.trim()
  if (!trimmed) {
    return { eligible: true, definitive: false }
  }

  const cache = await loadSparkleGeminiRegionCache()
  const proxies = await resolveCurrentProfileProxies()
  const matchedProxy = proxies.find((p) => String(p.name ?? '').trim() === trimmed)
  const fingerprint = matchedProxy ? computeProxyNodeFingerprint(matchedProxy) : undefined

  const existing = lookupGeminiRegionRecord(cache, trimmed, fingerprint)
  if (
    existing &&
    Date.now() - existing.checkedAt < (options?.maxAgeMs ?? Number.POSITIVE_INFINITY)
  ) {
    return {
      eligible: existing.eligible,
      countryCode: existing.countryCode,
      definitive: true
    }
  }

  try {
    const res = await withLocalProbeChannelLock(trimmed, () =>
      streamProbeGeminiRegionViaLocalListener()
    )
    if (!res.definitive || !res.countryCode) {
      return { eligible: true, definitive: false }
    }

    const record: GeminiRegionProbeRecord = {
      eligible: res.eligible,
      countryCode: res.countryCode,
      checkedAt: Date.now()
    }
    cache.set(fingerprint ?? trimmed, record)
    cache.set(trimmed, record)
    await saveSparkleGeminiRegionCache(cache)
    await noteGeminiRegionSample(trimmed, !res.eligible)

    if (!res.eligible) {
      await appendAppLog(
        `[SparkleGeminiProbe]: evicted region-restricted node "${trimmed}" (region=${res.countryCode})\n`
      )
      if (!options?.skipProviderReloadOnReject) {
        await rebuildAndReloadSparkleFastProvider()
      }
    } else {
      await appendAppLog(
        `[SparkleGeminiProbe]: verified eligible node "${trimmed}" (region=${res.countryCode})\n`
      )
    }

    return {
      eligible: res.eligible,
      countryCode: res.countryCode,
      definitive: true
    }
  } catch {
    return { eligible: true, definitive: false }
  }
}

let auditInFlight = false

/**
 * 后台巡检 `sparkle-fast` 中 mihomo 判定为 `alive: true` 且没有地区判定、或合格判定已临近过期的节点，
 * 提前把潜伏的“送中”节点剔除出 `自动选择` 候选池，并把确认解锁的节点维护进 `gemini专用`。
 */
export async function bootstrapSparkleGeminiRegionAudit(): Promise<void> {
  if (auditInFlight) {
    return
  }
  auditInFlight = true
  try {
    const provider = (await mihomoProxyProviders()).providers[FAST_NODE_PROVIDER_ID]
    const leaves = provider?.proxies ?? []
    if (leaves.length === 0) {
      return
    }

    const cache = await loadSparkleGeminiRegionCache()
    const proxies = await resolveCurrentProfileProxies()
    const fingerprintByName = new Map<string, string>()
    for (const p of proxies) {
      const n = String(p.name ?? '').trim()
      if (n) fingerprintByName.set(n, computeProxyNodeFingerprint(p))
    }

    const nowMs = Date.now()
    const dueAliveNames = leaves
      .filter((leaf) => {
        const alive = leaf.extra?.[AUTO_SELECT_DELAY_PROBE_URL]?.alive ?? leaf.alive
        if (!alive) return false
        const record = lookupGeminiRegionRecord(cache, leaf.name, fingerprintByName.get(leaf.name))
        return !record || (record.eligible && nowMs - record.checkedAt >= REFRESH_AFTER_MS)
      })
      .map((leaf) => leaf.name)

    let newlyRejected = 0
    for (const name of dueAliveNames) {
      const res = await verifyNodeGeminiRegion(name, {
        skipProviderReloadOnReject: true,
        maxAgeMs: REFRESH_AFTER_MS
      })
      if (res.definitive && !res.eligible) {
        newlyRejected += 1
      }
    }

    if (newlyRejected > 0) {
      await rebuildAndReloadSparkleFastProvider()
      await appendAppLog(
        `[SparkleGeminiProbe]: audit finished probed=${dueAliveNames.length} newly_evicted=${newlyRejected}\n`
      )
    }
    // 同一轮审计的地区结论同步维护 gemini专用：合格节点入池、失效节点出池，集合没变时内部自动跳过。
    await rebuildAndReloadGeminiProvider()
  } catch (error) {
    await appendAppLog(
      `[SparkleGeminiProbe]: audit error=${error instanceof Error ? error.message : String(error)}\n`
    )
  } finally {
    auditInFlight = false
  }
}

let geminiAuditTimer: NodeJS.Timeout | undefined

/**
 * 每轮先问开关：gemini 组被关闭时整轮跳过后台审计。
 * 自动选择挑节点时的按需地区校验（verifyNodeGeminiRegion）不经过这里，不受开关影响。
 */
export function startSparkleGeminiRegionAuditLoop(isEnabled: DedicatedGroupGate): void {
  if (geminiAuditTimer) {
    return
  }
  geminiAuditTimer = setInterval(() => {
    runWhenEnabled(isEnabled, bootstrapSparkleGeminiRegionAudit).catch(() => undefined)
  }, AUDIT_INTERVAL_MS)
  geminiAuditTimer.unref()
}
