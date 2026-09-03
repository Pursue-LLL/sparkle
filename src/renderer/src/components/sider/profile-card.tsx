import { Button, Card, CardBody, CardFooter, Chip, Tooltip } from '@heroui/react'
import { Meter } from '@heroui-v3/react'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { useLocation, useNavigate } from 'react-router-dom'
import { calcTraffic } from '@renderer/utils/calc'
import { CgLoadbarDoc } from 'react-icons/cg'
import { IoMdRefresh } from 'react-icons/io'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import React, { useState } from 'react'
import ConfigViewer from './config-viewer'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { TiFolder } from 'react-icons/ti'
import {
  subscriptionUpdateCardLabel,
  subscriptionUpdateTooltipLabel
} from '@sparkle-core/profileSubscriptionDisplayCore'
import { notify } from '@renderer/utils/notification'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface Props {
  iconOnly?: boolean
}

const ProfileCard: React.FC<Props> = (props) => {
  const { appConfig } = useAppConfig()
  const { iconOnly } = props
  const { profileCardStatus = 'col-span-2', disableAnimation = false } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/profiles')
  const [updating, setUpdating] = useState(false)
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)
  const { profileConfig, addProfileItem } = useProfileConfig()
  const { current, items } = profileConfig ?? {}
  const {
    attributes,
    listeners,
    setNodeRef,
    transform: tf,
    transition,
    isDragging
  } = useSortable({
    id: 'profile'
  })
  const transform = tf ? { x: tf.x, y: tf.y, scaleX: 1, scaleY: 1 } : null
  const info = items?.find((item) => item.id === current) ?? {
    id: 'default',
    type: 'local',
    name: '空白订阅'
  }

  const extra = info?.extra
  const usage = (extra?.upload ?? 0) + (extra?.download ?? 0)
  const total = extra?.total ?? 0

  if (iconOnly) {
    return (
      <div className={`${profileCardStatus} flex justify-center`}>
        <Tooltip content="订阅管理" placement="right">
          <Button
            size="sm"
            isIconOnly
            color={match ? 'primary' : 'default'}
            variant={match ? 'solid' : 'light'}
            onPress={() => {
              navigate('/profiles')
            }}
          >
            <TiFolder className="text-[20px]" />
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
      className={`${profileCardStatus} profile-card`}
    >
      {showRuntimeConfig && <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />}
      {profileCardStatus === 'col-span-2' ? (
        <Card
          fullWidth
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`${match ? 'bg-primary' : 'hover:bg-primary/30'} ${isDragging ? `${disableAnimation ? '' : 'scale-[0.95]'} tap-highlight-transparent` : ''}`}
        >
          <CardBody className="pb-1">
            <div
              ref={setNodeRef}
              {...attributes}
              {...listeners}
              className="flex justify-between h-8"
            >
              <h3
                title={info?.name}
                className={`text-ellipsis whitespace-nowrap overflow-hidden text-md font-bold leading-8 ${match ? 'text-primary-foreground' : 'text-foreground'} `}
              >
                {info?.name}
              </h3>
              <div className="flex shrink-0" data-no-dnd onClick={(e) => e.stopPropagation()}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  color="default"
                  onPress={() => {
                    setShowRuntimeConfig(true)
                  }}
                >
                  <CgLoadbarDoc
                    className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                  />
                </Button>
                {info.type === 'remote' && (
                  <Tooltip delay={1000} placement="left" content={dayjs(info.updated).fromNow()}>
                    <Button
                      isIconOnly
                      size="sm"
                      disabled={updating}
                      variant="light"
                      color="default"
                      onPress={async () => {
                        setUpdating(true)
                        await addProfileItem(info)
                        if (!info.url) {
                          notify(
                            '已从本地缓存重新加载。订阅 URL 缺失，无法远端更新，请在订阅设置中补填链接。',
                            { variant: 'warning' }
                          )
                        }
                        setUpdating(false)
                      }}
                    >
                      <IoMdRefresh
                        className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'} ${updating ? 'animate-spin' : ''}`}
                      />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
            {info.type === 'remote' && extra && (
              <div
                className={`mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'} `}
              >
                <small>{`${calcTraffic(usage)}/${calcTraffic(total)}`}</small>
                <Tooltip
                  delay={1000}
                  placement="left"
                  content={subscriptionUpdateTooltipLabel(
                    info.updated,
                    info.updateTime,
                    info.interval
                  )}
                >
                  <small className="cursor-default">
                    {subscriptionUpdateCardLabel(
                      info.updated,
                      dayjs(info.updated).fromNow(),
                      info.updateTime,
                      info.interval
                    )}
                  </small>
                </Tooltip>
              </div>
            )}
          </CardBody>
          <CardFooter className="pt-0">
            {info.type === 'remote' && !extra && (
              <div
                className={`w-full mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                <Chip
                  size="sm"
                  variant="bordered"
                  className={`${match ? 'text-primary-foreground border-primary-foreground' : 'border-primary text-primary'}`}
                >
                  远程
                </Chip>
                <small>
                  {subscriptionUpdateCardLabel(
                    info.updated,
                    dayjs(info.updated).fromNow(),
                    info.updateTime,
                    info.interval
                  )}
                </small>
              </div>
            )}
            {info.type === 'local' && (
              <div
                className={`mt-2 flex justify-between ${match ? 'text-primary-foreground' : 'text-foreground'}`}
              >
                <Chip
                  size="sm"
                  variant="bordered"
                  className={`${match ? 'text-primary-foreground border-primary-foreground' : 'border-primary text-primary'}`}
                >
                  本地
                </Chip>
              </div>
            )}
            {extra && (
              <Meter aria-label="流量用量" maxValue={total} value={usage}>
                <Meter.Track
                  className={
                    match
                      ? 'h-2.5 bg-black/22 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]'
                      : undefined
                  }
                >
                  <Meter.Fill
                    className={
                      match
                        ? 'bg-(--color-accent-foreground) shadow-[0_0_8px_rgb(255_255_255/0.45)]'
                        : undefined
                    }
                  />
                </Meter.Track>
              </Meter>
            )}
          </CardFooter>
        </Card>
      ) : (
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
                <TiFolder
                  color="default"
                  className={`${match ? 'text-primary-foreground' : 'text-foreground'} text-[24px]`}
                />
              </Button>
              <Button
                isIconOnly
                className="bg-transparent"
                variant="flat"
                color="default"
                onPress={() => {
                  setShowRuntimeConfig(true)
                }}
              >
                <CgLoadbarDoc
                  className={`text-[24px] ${match ? 'text-primary-foreground' : 'text-foreground'}`}
                />
              </Button>
            </div>
          </CardBody>
          <CardFooter className="pt-1">
            <h3
              className={`text-md font-bold ${match ? 'text-primary-foreground' : 'text-foreground'}`}
            >
              订阅管理
            </h3>
          </CardFooter>
        </Card>
      )}
    </div>
  )
}

export default ProfileCard
