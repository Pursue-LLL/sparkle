// [INPUT] 当前订阅节点 · 地区优先级 · Gemini 地区探测缓存（vXmutd）· 节点延迟样本 ·
//         cursorProxyGroup::GEMINI_DEDICATED_GROUP_NAME/DEFAULT_GENERAL_DELAY_TEST_URL (POS: Sparkle 分组名常量与判定谓词) ·
//         proxyNodeFingerprintCore::computeProxyNodeFingerprint (POS: 节点指纹) ·
//         regionPriority::nodeMatchesRegion (POS: 地区优先级与地区匹配) ·
//         sparkleGeminiProbeCore::GeminiRegionProbeCache (POS: Gemini 地区判定纯函数)
// [OUTPUT] GEMINI_NODE_PROVIDER_ID · GEMINI_NODE_PROVIDER_FILENAME · orderGeminiProxies ·
//          buildSparkleGeminiProviderDocument · buildGeminiGroupConfig · geminiProviderMembershipChanged
// [POS] `gemini专用` 的专属 provider 与组配置生成逻辑：
// 只保留经 vXmutd 流式探测明确判定「地区已解锁」的节点，按地区优先级分段、段内延迟升序，最多 12 个；
// 组为 `fallback`（按 provider 顺序取首个存活节点），健康检查只用轻量 204 量存活，不拿 Gemini 首页测速；
// 冷启动尚无已验证节点时排除已确认锁区的节点兜底，绝不返回空 provider（空 provider 会让整组退化为 COMPATIBLE 直连）。

import {
  DEFAULT_GENERAL_DELAY_TEST_URL,
  GEMINI_DEDICATED_GROUP_NAME
} from './cursorProxyGroup'
import { computeProxyNodeFingerprint } from './proxyNodeFingerprintCore'
import { nodeMatchesRegion } from './regionPriority'
import type { GeminiRegionProbeCache, GeminiRegionProbeRecord } from './sparkleGeminiProbeCore'
import type { MailProxyRecord } from './sparkleMailProviderCore'

export const GEMINI_NODE_PROVIDER_ID = 'gemini专用' as const
export const GEMINI_NODE_PROVIDER_FILENAME = 'gemini专用-proxies.yaml' as const

/** 池子上限：地区合格节点按优先级与延迟取前 12 个，避免 provider 膨胀与无意义的全量体检。 */
export const GEMINI_POOL_MAX_SIZE = 12

export type GeminiProxyRecord = MailProxyRecord

function proxyName(proxy: GeminiProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

function regionRecordOf(
  proxy: GeminiProxyRecord,
  regionCache?: GeminiRegionProbeCache
): GeminiRegionProbeRecord | undefined {
  if (!regionCache || regionCache.size === 0) {
    return undefined
  }
  return regionCache.get(computeProxyNodeFingerprint(proxy)) ?? regionCache.get(proxyName(proxy))
}

/** 地区优先级分段（优先地区在前、其余垫底），段内按实测延迟升序，无样本垫段尾。 */
function orderByRegionThenDelay(
  pool: GeminiProxyRecord[],
  regionPriority: readonly string[],
  delayMs?: ReadonlyMap<string, number>
): GeminiProxyRecord[] {
  const included = new Set<string>()
  const ordered: GeminiProxyRecord[] = []

  const take = (matches: (name: string) => boolean): void => {
    const segment: GeminiProxyRecord[] = []
    for (const proxy of pool) {
      const name = proxyName(proxy)
      if (!name || included.has(name) || !matches(name)) {
        continue
      }
      included.add(name)
      segment.push(proxy)
    }
    segment.sort((a, b) => {
      const delayA = delayMs?.get(proxyName(a)) ?? Number.POSITIVE_INFINITY
      const delayB = delayMs?.get(proxyName(b)) ?? Number.POSITIVE_INFINITY
      return delayA === delayB ? 0 : delayA < delayB ? -1 : 1
    })
    ordered.push(...segment)
  }

  for (const region of regionPriority) {
    take((name) => nodeMatchesRegion(name, region))
  }
  take(() => true)
  return ordered
}

/**
 * 筛选并排序 `gemini专用` 的节点：
 * 1. 已有明确判定合格（`eligible === true`）的节点时，只保留这些 100% 确认地区解锁的节点；
 * 2. 冷启动尚无合格样本时，排除已确认锁区/送中（`eligible === false`）的节点，未知节点按序兜底；
 * 3. 极端兜底：绝不返回空数组（除非输入本身为空），防止空 provider 让整组退化为 COMPATIBLE 直连；
 * 4. 最终按地区优先级分段、段内延迟升序，最多保留 {@link GEMINI_POOL_MAX_SIZE} 个。
 */
export function orderGeminiProxies(
  proxies: readonly GeminiProxyRecord[],
  regionPriority: readonly string[],
  regionCache?: GeminiRegionProbeCache,
  delayMs?: ReadonlyMap<string, number>
): GeminiProxyRecord[] {
  const seenNames = new Set<string>()
  const unique: GeminiProxyRecord[] = []
  for (const proxy of proxies) {
    const name = proxyName(proxy)
    if (!name || seenNames.has(name)) {
      continue
    }
    seenNames.add(name)
    unique.push(proxy)
  }
  if (unique.length === 0) {
    return []
  }

  const verified = unique.filter((proxy) => regionRecordOf(proxy, regionCache)?.eligible === true)
  const notConfirmedBlocked = unique.filter(
    (proxy) => regionRecordOf(proxy, regionCache)?.eligible !== false
  )
  const pool =
    verified.length > 0 ? verified : notConfirmedBlocked.length > 0 ? notConfirmedBlocked : unique

  return orderByRegionThenDelay(pool, regionPriority, delayMs).slice(0, GEMINI_POOL_MAX_SIZE)
}

export function buildSparkleGeminiProviderDocument(input: {
  proxies: readonly GeminiProxyRecord[]
  regionPriority: readonly string[]
  regionCache?: GeminiRegionProbeCache
  delayMs?: ReadonlyMap<string, number>
}): { proxies: GeminiProxyRecord[] } {
  return {
    proxies: orderGeminiProxies(
      input.proxies,
      input.regionPriority,
      input.regionCache,
      input.delayMs
    )
  }
}

/** provider 成员集合是否变化；顺序变化不触发热重载，只有增删节点才需要让 mihomo 重读。 */
export function geminiProviderMembershipChanged(
  previousNames: readonly string[],
  nextNames: readonly string[]
): boolean {
  const previous = new Set(previousNames)
  const next = new Set(nextNames)
  if (previous.size !== next.size) {
    return true
  }
  for (const name of next) {
    if (!previous.has(name)) {
      return true
    }
  }
  return false
}

export interface GeminiProxyGroupShape {
  name: string
  type?: string
  url?: string
  interval?: number
  timeout?: number
  lazy?: boolean
  proxies?: string[]
  use?: string[]
}

/**
 * `gemini专用` 用 fallback（不是 url-test / select）：成员资格已由 vXmutd 地区探测把关，
 * fallback 按 provider 的「地区优先级 + 延迟」顺序取首个存活节点，节点死亡自动顺延，
 * 不需要应用层再维护一个切节点状态机；健康检查只量存活与延迟。
 */
export function buildGeminiGroupConfig(
  leafNames: readonly string[],
  profileId: string | undefined
): GeminiProxyGroupShape | null {
  if (profileId) {
    // 没有叶子节点时 provider 文件不会被写出；此时建组会让 mihomo 引用不存在的 provider。
    if (leafNames.length === 0) {
      return null
    }
    return {
      name: GEMINI_DEDICATED_GROUP_NAME,
      type: 'fallback',
      url: DEFAULT_GENERAL_DELAY_TEST_URL,
      interval: 300,
      timeout: 5000,
      lazy: true,
      use: [GEMINI_NODE_PROVIDER_ID]
    }
  }

  const members = [...new Set(leafNames.map((name) => name.trim()).filter(Boolean))]
  if (members.length === 0) {
    return null
  }
  return {
    name: GEMINI_DEDICATED_GROUP_NAME,
    type: 'fallback',
    url: DEFAULT_GENERAL_DELAY_TEST_URL,
    interval: 300,
    timeout: 5000,
    lazy: true,
    proxies: members
  }
}
