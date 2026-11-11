// [INPUT] @renderer/utils/grok-probe-display（POS: grok 实测 → 毫秒/403/超时文案与色调）
// [OUTPUT] GrokDelayControl: `grok 专用` 节点的真实请求状态 Chip
// [POS] grok 组状态展示。只显示真实 grok.com HEAD 请求的结论；未探测显示「—」，
//       不借用 mihomo 的网络延迟样本，避免把 Cloudflare 403 当成可用。

import React, { useEffect, useState } from 'react'
import { resolveGrokProbeDisplay } from '@renderer/utils/grok-probe-display'
import { PROXY_DELAY_AGE_TICK_MS } from '@renderer/utils/proxy-delay-sample-age'
import ProbeDelayControl from './probe-delay-control'

export default function GrokDelayControl({
  sample
}: {
  sample: GrokProbeSample | null
}): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!sample) {
      return
    }
    const timer = setInterval(() => setNowMs(Date.now()), PROXY_DELAY_AGE_TICK_MS)
    return () => clearInterval(timer)
  }, [sample])

  const display = resolveGrokProbeDisplay(sample, nowMs)
  return (
    <ProbeDelayControl
      text={display.text}
      tone={display.tone}
      tooltip={display.tooltip}
      age={display.age}
    />
  )
}
