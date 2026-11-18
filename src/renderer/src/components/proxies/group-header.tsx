// [INPUT] @renderer/utils/cursor-proxy-groups（POS: 探针地址展示） · @sparkle-core/cursorProxyGroup（POS: Sparkle 分组名常量与判定谓词） ·
//         @renderer/components/base/collapse-input（POS: 可折叠搜索框） ·
//         @renderer/components/proxies/dedicated-group-switch（POS: 专用组启用开关） ·
//         @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表与开关解析，仅取 `DedicatedGroupId` 类型）
// [OUTPUT] GroupHeader · GroupProbeMode · resolveGroupProbeMode
// [POS] 代理页分组标题行：名称/当前节点/探针口径、可开关专用组的启用开关、节点数、搜索、定位、组测速与展开箭头。
import { Button, Card, CardBody, Chip } from '@heroui/react'
import { Avatar } from '@heroui-v3/react'
import { memo } from 'react'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { IoIosArrowBack } from 'react-icons/io'
import { MdOutlineSpeed } from 'react-icons/md'
import CollapseInput from '@renderer/components/base/collapse-input'
import { formatDelayTestUrlDisplay } from '@renderer/utils/cursor-proxy-groups'
import { AGY_DEDICATED_GROUP_NAME, GROK_DEDICATED_GROUP_NAME } from '@sparkle-core/cursorProxyGroup'
import type { DedicatedGroupId } from '@sparkle-core/dedicatedGroups'
import { DedicatedGroupSwitch } from './dedicated-group-switch'

/** 延迟口径：普通组走 mihomo 样本；agy / grok 走主进程真实请求快照。 */
export type GroupProbeMode = 'mihomo' | 'agy' | 'grok'

export function resolveGroupProbeMode(groupName: string): GroupProbeMode {
  if (groupName === AGY_DEDICATED_GROUP_NAME) {
    return 'agy'
  }
  if (groupName === GROK_DEDICATED_GROUP_NAME) {
    return 'grok'
  }
  return 'mihomo'
}

interface GroupHeaderProps {
  index: number
  group: ControllerMixedGroup
  probeUrl: string
  /** agy / grok 组：面板不展示 mihomo 网络延迟，改用真实请求实测。 */
  probeMode: GroupProbeMode
  isOpen: boolean
  isLast: boolean
  groupDisplayLayout: 'hidden' | 'single' | 'double'
  searchValue: string
  delaying: boolean
  /** 可开关的专用组才有；其余分组不显示启用开关。 */
  dedicatedId: DedicatedGroupId | undefined
  dedicatedEnabled: boolean
  dedicatedPending: boolean
  onToggleDedicated: (id: DedicatedGroupId, enabled: boolean) => void
  onToggle: (index: number, currentlyOpen: boolean) => void
  onUpdateSearch: (index: number, value: string) => void
  onScrollToProxy: (index: number) => void
  onGroupDelay: (index: number) => void
}

export const GroupHeader = memo(function GroupHeader({
  index,
  group,
  probeUrl,
  probeMode,
  isOpen,
  isLast,
  groupDisplayLayout,
  searchValue,
  delaying,
  dedicatedId,
  dedicatedEnabled,
  dedicatedPending,
  onToggleDedicated,
  onToggle,
  onUpdateSearch,
  onScrollToProxy,
  onGroupDelay
}: GroupHeaderProps) {
  let probeLabel = `探针 ${formatDelayTestUrlDisplay(probeUrl)}`
  let probeTitle = `探针地址: ${probeUrl}`
  if (probeMode === 'agy') {
    probeLabel = 'agy 实测'
    probeTitle = 'agy 真实请求实测（每 3 分钟自动复测当前节点）'
  } else if (probeMode === 'grok') {
    probeLabel = 'grok 实测'
    probeTitle = 'grok.com 真实请求实测（每 60 秒复核当前节点，失败自动切换）'
  }
  return (
    <div className={`w-full pt-2 ${isLast && !isOpen ? 'pb-2' : ''} px-2`}>
      <Card as="div" isPressable fullWidth onPress={() => onToggle(index, isOpen)}>
        <CardBody className="w-full min-h-14 h-auto py-2">
          <div className="flex justify-between h-full">
            <div className="flex text-ellipsis overflow-hidden whitespace-nowrap h-full">
              {group.icon ? (
                <Avatar
                  className="mr-2 h-8 w-8 shrink-0 bg-transparent overflow-visible! rounded-none!"
                  size="sm"
                >
                  <Avatar.Image
                    className="object-contain"
                    src={
                      group.icon.startsWith('<svg')
                        ? `data:image/svg+xml;utf8,${group.icon}`
                        : localStorage.getItem(group.icon) || group.icon
                    }
                  />
                </Avatar>
              ) : null}
              <div
                className={`flex flex-col h-full ${
                  groupDisplayLayout === 'double' ? '' : 'justify-center'
                }`}
              >
                <div
                  className={`text-ellipsis overflow-hidden whitespace-nowrap leading-tight ${
                    groupDisplayLayout === 'double' ? 'text-md flex-5 flex items-center' : 'text-lg'
                  }`}
                >
                  <span className="flag-emoji inline-block">{group.name}</span>
                  {groupDisplayLayout === 'single' && (
                    <>
                      <div className="inline ml-2 text-sm text-foreground-500">{group.type}</div>
                      <div className="inline flag-emoji ml-2 text-sm text-foreground-500">
                        {group.now}
                      </div>
                    </>
                  )}
                </div>
                {(groupDisplayLayout === 'double' || groupDisplayLayout === 'single') && (
                  <div className="text-ellipsis whitespace-nowrap text-[10px] text-foreground-500 leading-tight flex-3 flex items-center gap-x-1.5 min-w-0">
                    {groupDisplayLayout === 'double' && (
                      <>
                        <span>{group.type}</span>
                        <span className="flag-emoji inline-block">{group.now}</span>
                      </>
                    )}
                    <span className="truncate min-w-0" title={probeTitle}>
                      {probeLabel}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center">
              <div
                className="flex items-center"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {dedicatedId && (
                  <DedicatedGroupSwitch
                    id={dedicatedId}
                    enabled={dedicatedEnabled}
                    pending={dedicatedPending}
                    onChange={onToggleDedicated}
                  />
                )}
                <Chip size="sm" className="my-1 mr-2">
                  {group.all.length}
                </Chip>
                <CollapseInput
                  value={searchValue}
                  onValueChange={(v) => onUpdateSearch(index, v)}
                />
                <Button variant="light" size="sm" isIconOnly onPress={() => onScrollToProxy(index)}>
                  <FaLocationCrosshairs className="text-lg text-foreground-500" />
                </Button>
                {probeMode === 'mihomo' && (
                  <Button
                    variant="light"
                    isLoading={delaying}
                    size="sm"
                    isIconOnly
                    onPress={() => onGroupDelay(index)}
                  >
                    <MdOutlineSpeed className="text-lg text-foreground-500" />
                  </Button>
                )}
              </div>
              <IoIosArrowBack
                className={`transition duration-200 ml-2 h-8 text-lg text-foreground-500 flex items-center ${
                  isOpen ? '-rotate-90' : ''
                }`}
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
})
