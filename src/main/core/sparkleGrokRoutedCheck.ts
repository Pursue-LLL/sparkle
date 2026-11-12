// [INPUT] mihomo 的 mixed-port 配置 · grok.com 的真实响应（状态码与 cf-mitigated 头）
// [OUTPUT] ROUTED_CHECK_TIMEOUT_MS · RoutedCheckResult · resolveMixedPort · requestGrokViaRoute
// [POS] `grok 专用` 选路的唯一判定口径：经 App 的 mixed-port（不可用时依赖 TUN 直连）真实请求 grok.com，
//       只有 200 且无 cf-mitigated challenge 才算可用。

import axios from 'axios'
import { getControledMihomoConfig } from '../config'
import { isGrokRoutedResponseUsable } from './sparkleGrokProviderCore'

export const ROUTED_CHECK_TIMEOUT_MS = 8000
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface RoutedCheckResult {
  ok: boolean
  status: number
  rttMs: number
  reason?: string
}

/** mihomo 的 mixed-port；缺省、读不到或不是数字时为 NaN —— 调用方只把大于 0 的值当作可用端口。 */
export async function resolveMixedPort(): Promise<number> {
  const config = await getControledMihomoConfig().catch(() => undefined)
  return Number(config?.['mixed-port'])
}

/**
 * 唯一判定口径：真实请求 grok.com。
 * 用 HEAD 只取状态与响应头（实测 HEAD 与 GET 的 403/200 判定一致，且不下载 200KB 页面）。
 * mixed-port > 0 时显式走 HTTP 代理；否则依赖 TUN 直连（请求仍按路由规则进入 grok 专用组）。
 */
export async function requestGrokViaRoute(mixedPort: number): Promise<RoutedCheckResult> {
  const startedAt = Date.now()
  try {
    const res = await axios.request({
      method: 'HEAD',
      url: 'https://grok.com/',
      ...(mixedPort > 0
        ? { proxy: { protocol: 'http' as const, host: '127.0.0.1', port: mixedPort } }
        : {}),
      timeout: ROUTED_CHECK_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' }
    })
    const mitigated = String((res.headers as Record<string, unknown>)?.['cf-mitigated'] || '')
    const ok = isGrokRoutedResponseUsable(res.status, mitigated)
    const rttMs = Date.now() - startedAt
    return ok
      ? { ok, status: res.status, rttMs }
      : {
          ok,
          status: res.status,
          rttMs,
          reason: `HTTP ${res.status}${mitigated ? ` cf-mitigated=${mitigated}` : ''}`
        }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      rttMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
