// [INPUT] `https://gemini.google.com` 流式解压后的 HTML 片段 · 订阅节点列表 · 地区探测缓存
// [OUTPUT] BLOCKED_GEMINI_COUNTRY_CODES · evaluateGeminiHtmlEligibility · resolveGeminiBlockedNodeNames
// [POS] 识别「HTTP 200 但被 Google GeoIP 判定为送中/不支持地区（如 vXmutd="ZZ"/"CN"/"HK" 或 google.cn）」的假存活节点。
// 纯函数模块（无 I/O 与 Electron 依赖），便于单元测试。

import { computeMailNodeFingerprint, type MailProxyRecord } from './sparkleMailProviderCore'

/**
 * Google Gemini 明确锁区或送中的 ISO 地区码集合：
 * - `ZZ`: Google GeoIP 未知/无权限受限地区（机场脏 IPv6 / 送中节点访问 Gemini 时的典型返回值）
 * - `CN` / `HK` / `MO`: 中国大陆、香港、澳门
 * - `RU` / `BY` / `KP` / `IR` / `SY` / `CU`: 制裁/不支持地区
 */
export const BLOCKED_GEMINI_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'ZZ',
  'CN',
  'HK',
  'MO',
  'RU',
  'BY',
  'KP',
  'IR',
  'SY',
  'CU'
])

export interface GeminiRegionProbeRecord {
  eligible: boolean
  countryCode: string
  checkedAt: number
}

export type GeminiRegionProbeCache = ReadonlyMap<string, GeminiRegionProbeRecord>

export interface GeminiHtmlEligibilityResult {
  /** 是否已在当前已接收的 HTML 流中得出确定结论（得出结论即可立即断开连接，无需下载后续内容） */
  settled: boolean
  /** 该节点是否真正支持访问 Gemini */
  eligible: boolean
  /** 提取到的 Google 判定地区码（如 "TW", "JP", "SG", "US", "ZZ", "HK", "CN"） */
  countryCode?: string
}

const VXMUTD_REGION_REGEX = /"vXmutd":"%\.@\.\\"([A-Za-z]{2})\\"/
const GOOGLE_CN_OGB_MARKER = 'https://www.google.cn/intl/'
const BLOCKED_LANDING_MODULE_MARKER = '/dti=1/m=LQaXg'

export function isGeminiCountryCodeEligible(countryCode: string): boolean {
  const normalized = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return false
  }
  return !BLOCKED_GEMINI_COUNTRY_CODES.has(normalized)
}

/**
 * 对流式读取到的 `https://gemini.google.com/` HTML 前缀做增量地区解锁判定：
 * 1. 一旦匹配到 `window.WIZ_global_data` 中的 `"vXmutd":"%.@.\"<CC>\""`（位于约 130KB 处），即可得出确定结论；
 * 2. 若页面出现 `https://www.google.cn/intl/` 或锁区专属模块 `/dti=1/m=LQaXg`，直接判定为锁区（`eligible: false`）；
 * 3. 若当前流尚未到达标记位置，返回 `settled: false` 通知调用方继续读取。
 */
export function evaluateGeminiHtmlEligibility(htmlPrefix: string): GeminiHtmlEligibilityResult {
  if (
    htmlPrefix.includes(GOOGLE_CN_OGB_MARKER) ||
    htmlPrefix.includes(BLOCKED_LANDING_MODULE_MARKER)
  ) {
    const match = VXMUTD_REGION_REGEX.exec(htmlPrefix)
    const countryCode = match ? match[1].toUpperCase() : 'CN'
    return {
      settled: true,
      eligible: false,
      countryCode
    }
  }

  const match = VXMUTD_REGION_REGEX.exec(htmlPrefix)
  if (!match) {
    return {
      settled: false,
      eligible: false
    }
  }

  const countryCode = match[1].toUpperCase()
  return {
    settled: true,
    eligible: isGeminiCountryCodeEligible(countryCode),
    countryCode
  }
}

/**
 * 根据持久化缓存，提取当前订阅中已确认为「Gemini 锁区/送中」（`eligible === false`）的节点名称集合。
 * 同时兼容按节点唯一指纹（`name|type|server|port`）和按纯节点名查找。
 */
export function resolveGeminiBlockedNodeNames(
  proxies: readonly MailProxyRecord[],
  cache?: GeminiRegionProbeCache
): Set<string> {
  const blocked = new Set<string>()
  if (!cache || cache.size === 0) {
    return blocked
  }

  for (const proxy of proxies) {
    const name = String(proxy.name ?? '').trim()
    if (!name) {
      continue
    }
    const record = cache.get(computeMailNodeFingerprint(proxy)) ?? cache.get(name)
    if (record && record.eligible === false) {
      blocked.add(name)
    }
  }
  return blocked
}
