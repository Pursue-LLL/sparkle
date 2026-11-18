import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useCoreRestarting } from '@renderer/hooks/use-core-restarting'
import { usePendingAction } from '@renderer/hooks/use-pending-action'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { TbDeviceIpadHorizontalBolt } from 'react-icons/tb'
import { useLocation, useNavigate } from 'react-router-dom'
import { restartCore } from '@renderer/utils/ipc'
import { notify } from '@renderer/utils/notification'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'

interface Props {
  iconOnly?: boolean
}

const TunSwitcher: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/tun') || false
  const { appConfig } = useAppConfig()
  const { tunCardStatus = 'col-span-1', disableAnimation = false } = appConfig || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { tun } = controledMihomoConfig || {}
  const { enable } = tun || {}
  const restarting = useCoreRestarting()
  const { pendingTarget, run: toggleTun } = usePendingAction(
    async (next: boolean): Promise<void> => {
      const applied = await patchControledMihomoConfig(
        next ? { tun: { enable: next }, dns: { enable: true } } : { tun: { enable: next } }
      )
      // 补丁失败时配置没变，重启内核只会白白中断连接。
      if (!applied) return
      try {
        await restartCore()
      } catch (e) {
        notify(e, { variant: 'danger' })
      }
      window.electron.ipcRenderer.send('updateFloatingWindow')
      window.electron.ipcRenderer.send('updateTrayMenu')
    }
  )
  const displayedEnable = pendingTarget ?? enable
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'tun'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null

  if (iconOnly) {
    return (
      <div className={`${tunCardStatus} flex justify-center`}>
        <Tooltip content="虚拟网卡" placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/tun')
            }}
          >
            <TbDeviceIpadHorizontalBolt className="text-[20px]" />
          </Button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={`${tunCardStatus} tun-card`}
    >
      <Card
        fullWidth
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimation ? '' : 'scale-[0.95]'} tap-highlight-transparent` : ''}`}
      >
        <CardBody className="pb-1 pt-0 px-0 overflow-y-visible">
          <div className="flex justify-between">
            <Button
              isIconOnly
              className="bg-transparent pointer-events-none"
              variant="flat"
              color="default"
            >
              <TbDeviceIpadHorizontalBolt
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && displayedEnable}
              isSelected={displayedEnable}
              isDisabled={pendingTarget !== undefined || restarting}
              onValueChange={toggleTun}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            虚拟网卡
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default TunSwitcher
