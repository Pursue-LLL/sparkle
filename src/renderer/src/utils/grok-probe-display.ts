// [INPUT] GrokProbeSample（来源：主进程 sparkleGrokProbe 的内存快照，经 IPC 到代理页）
// [OUTPUT] formatGrokProbeDelay · resolveGrokProbeDisplay
// [POS] `grok 专用` 延迟的唯一格式口径：只展示真实 grok.com HEAD 请求的结论——
//       200 显示毫秒，403 显示挑战，超时/其它显示失败；绝不用 mihomo 的「403 也算成功」冒充可用。

import { formatProxyDelaySampleAge } from './proxy-delay-sample-age'

export type GrokProbeTone = 'default' | 'success' | 'warning' | 'danger'

export interface GrokProbeDisplay {
  text: string
  tone: GrokProbeTone
  tooltip: string
  age?: string
}

const UNTESTED_TOOLTIP = '该节点尚未探测；只有切换到它或被自动选路验证时才会真实请求 grok.com'

/** 与其它组一致，Chip 只显示毫秒数字；单位放在 tooltip，避免占用卡片宽度。 */
export function formatGrokProbeDelay(rttMs: number): string {
  return Number.isFinite(rttMs) && rttMs > 0 ? String(Math.round(rttMs)) : '—'
}

export function resolveGrokProbeDisplay(
  sample: GrokProbeSample | null,
  nowMs: number
): GrokProbeDisplay {
  if (!sample) {
    return { text: '—', tone: 'default', tooltip: UNTESTED_TOOLTIP }
  }

  const age = formatProxyDelaySampleAge(new Date(sample.checkedAt).toISOString(), nowMs, 'zh')
  const ageSuffix = age ? ` · ${age}` : ''

  if (sample.state === 'failed') {
    if (sample.status === 403) {
      return {
        text: '403',
        tone: 'warning',
        tooltip: `grok.com 返回 HTTP 403（Cloudflare 挑战，该出口打不开页面）${ageSuffix}`,
        ...(age ? { age } : {})
      }
    }
    if (sample.status === 0) {
      const reason = sample.reason ? `：${sample.reason}` : ''
      return {
        text: '超时',
        tone: 'danger',
        tooltip: `grok.com 请求超时${reason}${ageSuffix}`,
        ...(age ? { age } : {})
      }
    }
    const reason = sample.reason ? `：${sample.reason}` : ''
    return {
      text: '失败',
      tone: 'danger',
      tooltip: `上次探测失败${reason}${ageSuffix}`,
      ...(age ? { age } : {})
    }
  }

  const text = formatGrokProbeDelay(sample.rttMs)
  return {
    text,
    tone: sample.rttMs > 0 ? (sample.rttMs < 500 ? 'success' : 'warning') : 'default',
    tooltip: `grok.com 真实请求 200 · ${Math.round(sample.rttMs)}ms${ageSuffix}`,
    ...(age ? { age } : {})
  }
}
