import { Button, Card, CardBody, CardFooter, Tooltip } from '@heroui/react'
import BorderSwitch from '@renderer/components/base/border-swtich'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { usePendingAction } from '@renderer/hooks/use-pending-action'
import { triggerSysProxy } from '@renderer/utils/ipc'
import { AiOutlineGlobal } from 'react-icons/ai'
import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { notify } from '@renderer/utils/notification'

interface Props {
  iconOnly?: boolean
}

const SysproxySwitcher: React.FC<Props> = (props) => {
  const { iconOnly } = props
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/sysproxy')
  const { appConfig, patchAppConfig } = useAppConfig()
  const {
    sysProxy,
    sysproxyCardStatus = 'col-span-1',
    onlyActiveDevice = false,
    disableAnimation = false
  } = appConfig || {}
  const { enable, mode } = sysProxy || {}
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { 'mixed-port': mixedPort } = controledMihomoConfig || {}
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'sysproxy'
  })

  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const disabled = mixedPort == 0
  const { pendingTarget, run: toggleSysProxy } = usePendingAction(
    async (next: boolean): Promise<void> => {
      try {
        await triggerSysProxy(next, onlyActiveDevice)
        await patchAppConfig({ sysProxy: { enable: next } })
        window.electron.ipcRenderer.send('updateFloatingWindow')
        window.electron.ipcRenderer.send('updateTrayMenu')
      } catch (e) {
        notify(e, { variant: 'danger' })
      }
    }
  )
  const displayedEnable = pendingTarget ?? enable
  const onChange = (next: boolean): void => {
    if (mode == 'manual' && disabled) return
    void toggleSysProxy(next)
  }

  if (iconOnly) {
    return (
      <div className={`${sysproxyCardStatus} flex justify-center`}>
        <Tooltip content="系统代理" placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/sysproxy')
            }}
          >
            <AiOutlineGlobal className="text-[20px]" />
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
      className={`${sysproxyCardStatus} sysproxy-card`}
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
              <AiOutlineGlobal
                className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px] font-bold`}
              />
            </Button>
            <BorderSwitch
              isShowBorder={match && displayedEnable}
              isSelected={!(mode != 'auto' && disabled) && displayedEnable}
              isDisabled={(mode == 'manual' && disabled) || pendingTarget !== undefined}
              onValueChange={onChange}
            />
          </div>
        </CardBody>
        <CardFooter className="pt-1">
          <h3
            className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            系统代理
          </h3>
        </CardFooter>
      </Card>
    </div>
  )
}

export default SysproxySwitcher
