import { Chip, Spinner, Tooltip } from '@heroui/react'
import React from 'react'
import { useProbeWarmup } from '@renderer/hooks/use-probe-warmup'

/** 内核刚启动、批量测速未完成时的页头提示；窗口结束后不渲染。 */
const ProbeWarmupChip: React.FC = () => {
  const warmingUp = useProbeWarmup()
  if (!warmingUp) return null

  return (
    <Tooltip content="内核刚启动，节点延迟正在批量测速（约 1~2 分钟）。期间不显示超时，可正常切换节点。">
      <Chip
        size="sm"
        variant="flat"
        color="warning"
        className="app-nodrag"
        startContent={<Spinner size="sm" color="warning" className="scale-75" />}
      >
        测速预热中
      </Chip>
    </Tooltip>
  )
}

export default ProbeWarmupChip
