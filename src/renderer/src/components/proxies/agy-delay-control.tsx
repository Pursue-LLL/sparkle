// [INPUT] @renderer/utils/agy-probe-display（POS: agy 实测毫秒 → 秒级文案/色调） ·
//         @renderer/utils/proxy-delay-sample-age（POS: 样本年龄文案） · ./probe-delay-control（POS: 统一实测 Chip）
// [OUTPUT] AgyDelayControl: agy 组状态 Chip（可用秒级 / 锁区 / 失败 / —（未探测）+ 距上次探测时间）
// [POS] agy 组状态展示。只显示真实 agy 请求结论，绝不借用 mihomo 的 gstatic 网络延迟冒充 agy 响应时间。

import React, { useEffect, useState } from 'react'
import { agyProbeTone, formatAgyProbeDelay } from '@renderer/utils/agy-probe-display'
import {
  formatProxyDelaySampleAge,
  PROXY_DELAY_AGE_TICK_MS
} from '@renderer/utils/proxy-delay-sample-age'
import ProbeDelayControl from './probe-delay-control'

function resolveDisplay(
  sample: AgyProbeSample | null,
  nowMs: number
): { text: string; tone: 'default' | 'success' | 'warning' | 'danger'; tooltip: string; age?: string } {
  if (!sample) {
    return {
      text: '—',
      tone: 'default',
      tooltip: '该节点尚未探测；只有切换到它时才会发起真实 agy 请求'
    }
  }
  const age = formatProxyDelaySampleAge(new Date(sample.checkedAt).toISOString(), nowMs, 'zh')
  const reason = sample.reason ? `：${sample.reason}` : ''
  if (sample.state === 'failed') {
    return {
      text: '失败',
      tone: 'danger',
      tooltip: `上次探测失败${reason}${age ? ` · ${age}` : ''}`,
      ...(age ? { age } : {})
    }
  }
  if (sample.state === 'unusable') {
    return {
      text: '锁区',
      tone: 'warning',
      tooltip: `agy 地区不支持${reason}${age ? ` · ${age}` : ''}`,
      ...(age ? { age } : {})
    }
  }
  const text = formatAgyProbeDelay(sample.rttMs)
  return {
    text,
    tone: agyProbeTone(sample.rttMs),
    tooltip: `agy 真实请求 ${text}${age ? ` · ${age}` : ''}`,
    ...(age ? { age } : {})
  }
}

export default function AgyDelayControl({
  sample
}: {
  sample: AgyProbeSample | null
}): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!sample) {
      return
    }
    const timer = setInterval(() => setNowMs(Date.now()), PROXY_DELAY_AGE_TICK_MS)
    return () => clearInterval(timer)
  }, [sample])

  const display = resolveDisplay(sample, nowMs)
  return (
    <ProbeDelayControl
      text={display.text}
      tone={display.tone}
      tooltip={display.tooltip}
      age={display.age}
    />
  )
}
