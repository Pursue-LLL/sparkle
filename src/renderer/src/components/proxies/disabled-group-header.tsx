// [INPUT] @renderer/components/proxies/dedicated-group-switch（POS: 启用开关） · @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表与开关解析）
// [OUTPUT] DisabledGroupHeader: 已关闭专用组的占位标题
// [POS] 代理页里已关闭的专用组：停在它原本的位置，只显示名称与「已关闭」说明和开关，可随时重新开启；不可展开，也没有节点。
//       开启进行中（内核尚未载入该组）开关已翻到「开」，说明改为「正在开启…」。
import { Card, CardBody } from '@heroui/react'
import { memo } from 'react'
import { DEDICATED_GROUPS, type DedicatedGroupId } from '@sparkle-core/dedicatedGroups'
import { DedicatedGroupSwitch } from './dedicated-group-switch'

interface DisabledGroupHeaderProps {
  id: DedicatedGroupId
  isLast: boolean
  /** 展示值：切换进行中为用户要的目标值。 */
  enabled: boolean
  pending: boolean
  onToggle: (id: DedicatedGroupId, enabled: boolean) => void
}

function statusText(enabled: boolean, pending: boolean): string {
  if (!pending) {
    return '已关闭 · 不再检测'
  }
  return enabled ? '正在开启…' : '正在关闭…'
}

export const DisabledGroupHeader = memo(function DisabledGroupHeader({
  id,
  isLast,
  enabled,
  pending,
  onToggle
}: DisabledGroupHeaderProps) {
  return (
    <div className={`w-full pt-2 ${isLast ? 'pb-2' : ''} px-2`}>
      <Card as="div" fullWidth>
        <CardBody className="w-full min-h-14 h-auto py-2">
          <div className="flex justify-between items-center h-full">
            <div className="flex flex-col justify-center min-w-0 opacity-60">
              <span className="flag-emoji text-lg leading-tight truncate">
                {DEDICATED_GROUPS[id].name}
              </span>
              <span className="text-[10px] text-foreground-500 leading-tight">
                {statusText(enabled, pending)}
              </span>
            </div>
            <div className="flex items-center ml-2">
              <DedicatedGroupSwitch
                id={id}
                enabled={enabled}
                pending={pending}
                onChange={onToggle}
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
})
