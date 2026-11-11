// [INPUT] text / tone / tooltip / age（来源：agy、grok 各自的真实请求结论）
// [OUTPUT] ProbeDelayControl: 统一的应用层实测 Chip
// [POS] 专用组延迟展示的共同外壳：只负责渲染「短文案 + 色调 + tooltip + 样本年龄」，
//       不参与任何倍率/口径换算——数值由各组的 display 纯函数决定。

import { Tooltip } from '@heroui/react'
import React from 'react'

export type ProbeTone = 'default' | 'success' | 'warning' | 'danger'

const TONE_CLASS: Record<ProbeTone, string> = {
  default: 'bg-default-100 text-default-500',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger'
}

interface Props {
  text: string
  tone: ProbeTone
  tooltip: string
  age?: string
}

export default function ProbeDelayControl({
  text,
  tone,
  tooltip,
  age
}: Props): React.JSX.Element {
  return (
    <div className="flex flex-col items-center shrink-0">
      <Tooltip content={tooltip} placement="left" delay={200}>
        <div
          className={`flex h-8 w-8 min-w-8 items-center justify-center rounded-medium cursor-default ${TONE_CLASS[tone]}`}
        >
          <span className="text-xs">{text}</span>
        </div>
      </Tooltip>
      {age ? (
        <span className="text-[9px] text-foreground-400 leading-none mt-0.5 max-w-[56px] truncate">
          {age}
        </span>
      ) : null}
    </div>
  )
}
