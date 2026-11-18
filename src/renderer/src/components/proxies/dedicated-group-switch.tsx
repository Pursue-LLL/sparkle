// [INPUT] @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表：组名与面向用户的说明）
// [OUTPUT] DedicatedGroupSwitch: 分组标题上的启用开关
// [POS] 专用分组的开关控件（含说明气泡）；放在标题栏的事件隔离区内，点击不会展开 / 收起分组。
//       切换进行中开关已翻到目标值并在滑块里转圈，让数秒的重新生成与重载有可见的进度。
import { Spinner, Switch, Tooltip } from '@heroui/react'
import { DEDICATED_GROUPS, type DedicatedGroupId } from '@sparkle-core/dedicatedGroups'

interface DedicatedGroupSwitchProps {
  id: DedicatedGroupId
  /** 展示值：切换进行中为用户要的目标值。 */
  enabled: boolean
  /** 正在应用：期间禁用开关，避免重复触发。 */
  pending: boolean
  onChange: (id: DedicatedGroupId, enabled: boolean) => void
}

export function DedicatedGroupSwitch({
  id,
  enabled,
  pending,
  onChange
}: DedicatedGroupSwitchProps): React.JSX.Element {
  const { name, summary } = DEDICATED_GROUPS[id]
  return (
    <Tooltip content={summary} placement="bottom" delay={400} className="max-w-72">
      <div className="mr-2 flex items-center">
        <Switch
          size="sm"
          aria-label={`${name} 开关`}
          isSelected={enabled}
          isDisabled={pending}
          thumbIcon={
            pending ? <Spinner size="sm" classNames={{ wrapper: 'h-3 w-3' }} /> : undefined
          }
          onValueChange={(value) => onChange(id, value)}
        />
      </div>
    </Tooltip>
  )
}
