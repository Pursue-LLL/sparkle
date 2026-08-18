import { Button, Drawer, Input, InputGroup, Switch, Tooltip } from '@heroui-v3/react'
import React, { useState, useEffect, useRef } from 'react'
import SettingItem from '../base/base-setting-item'
import { settingItemProps } from '../base/base-controls'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { getGistUrl, getUserAgent } from '@renderer/utils/ipc'
import debounce from '@renderer/utils/debounce'
import { IoIosHelpCircle } from 'react-icons/io'
import { BiCopy, BiHide, BiShow } from 'react-icons/bi'
import { notify } from '@renderer/utils/notification'

interface Props {
  onClose: () => void
  reopenSignal?: number
}

const DRAWER_CLOSE_ANIMATION_MS = 700

const ProfileSettingDrawer: React.FC<Props> = (props) => {
  const { onClose, reopenSignal } = props
  const { appConfig, patchAppConfig } = useAppConfig()

  const {
    userAgent,
    diffWorkDir = false,
    githubToken = '',
    gistSyncEnabled = githubToken !== ''
  } = appConfig || {}

  const [ua, setUa] = useState(userAgent ?? '')
  const [tokenVisible, setTokenVisible] = useState(false)
  const [defaultUserAgent, setDefaultUserAgent] = useState<string>('')
  const userAgentFetched = useRef(false)
  const [isOpen, setIsOpen] = useState(true)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setUaDebounce = useRef(
    debounce((v: string) => {
      patchAppConfig({ userAgent: v })
    }, 500)
  ).current

  useEffect(() => {
    if (!userAgentFetched.current) {
      userAgentFetched.current = true
      getUserAgent().then((ua) => {
        setDefaultUserAgent(ua)
      })
    }
  }, [])

  useEffect(() => {
    setUa(userAgent ?? '')
  }, [userAgent])

  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setIsOpen(true)
  }, [reopenSignal])

  const closeWithAnimation = (): void => {
    if (closeTimer.current) return

    setIsOpen(false)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      onClose()
    }, DRAWER_CLOSE_ANIMATION_MS)
  }

  return (
    <Drawer.Backdrop
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) closeWithAnimation()
      }}
      variant="blur"
      className="top-12 h-[calc(100%-48px)]"
    >
      <Drawer.Content placement="right" className="top-12 h-[calc(100%-48px)] p-3 pl-0">
        <Drawer.Dialog className="flex h-full w-[min(460px,calc(100vw-32px))] max-w-none flex-col overflow-hidden rounded-2xl! border border-separator/70 bg-overlay p-0 shadow-overlay flag-emoji">
          <Drawer.Header className="border-b border-separator/70 px-5 py-4">
            <Drawer.Heading className="text-base font-semibold">订阅设置</Drawer.Heading>
          </Drawer.Header>
          <Drawer.Body className="no-scrollbar flex-1 overflow-y-auto px-5 py-3">
            <div className="flex flex-col gap-1">
              <SettingItem
                title="为不同订阅分别指定工作目录"
                actions={
                  <Tooltip>
                    <Button aria-label="说明" isIconOnly size="sm" variant="ghost">
                      <IoIosHelpCircle className="text-lg" />
                    </Button>
                    <Tooltip.Content>
                      开启后可以避免不同订阅中存在相同代理组名时无法分别保存选择的节点
                    </Tooltip.Content>
                  </Tooltip>
                }
                {...settingItemProps}
                divider
              >
                <Switch
                  aria-label="为不同订阅分别指定工作目录"
                  isSelected={diffWorkDir}
                  onChange={(v) => {
                    patchAppConfig({ diffWorkDir: v })
                  }}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </SettingItem>
              <SettingItem title="订阅拉取 UA" {...settingItemProps} divider>
                <Input
                  aria-label="订阅拉取 UA"
                  data-setting-input="wide"
                  value={ua}
                  placeholder={`默认 ${defaultUserAgent}`}
                  variant="secondary"
                  onChange={(event) => {
                    const v = event.target.value
                    setUa(v)
                    setUaDebounce(v)
                  }}
                />
              </SettingItem>
              <SettingItem
                title="同步运行时配置到 Gist"
                actions={
                  gistSyncEnabled && (
                    <Button
                      aria-label="复制 Gist URL"
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      onPress={async () => {
                        try {
                          const url = await getGistUrl()
                          if (url !== '') {
                            await navigator.clipboard.writeText(`${url}/raw/sparkle.yaml`)
                          }
                        } catch (e) {
                          notify(e, { variant: 'danger' })
                        }
                      }}
                    >
                      <BiCopy className="text-lg" />
                    </Button>
                  )
                }
                {...settingItemProps}
              >
                <Switch
                  aria-label="同步运行时配置到 Gist"
                  isSelected={gistSyncEnabled}
                  onChange={(v) => {
                    patchAppConfig({ gistSyncEnabled: v })
                  }}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </SettingItem>
              {gistSyncEnabled && (
                <SettingItem title={null} {...settingItemProps}>
                  <InputGroup data-setting-input="full" variant="secondary">
                    <InputGroup.Input
                      aria-label="GitHub Token"
                      type={tokenVisible ? 'text' : 'password'}
                      value={githubToken}
                      placeholder="GitHub Token"
                      onChange={(event) => {
                        patchAppConfig({ githubToken: event.target.value })
                      }}
                    />
                    <InputGroup.Suffix>
                      <Button
                        aria-label={tokenVisible ? '隐藏 GitHub Token' : '显示 GitHub Token'}
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        onPress={() => setTokenVisible((visible) => !visible)}
                      >
                        {tokenVisible ? (
                          <BiHide className="text-lg" />
                        ) : (
                          <BiShow className="text-lg" />
                        )}
                      </Button>
                    </InputGroup.Suffix>
                  </InputGroup>
                </SettingItem>
              )}
            </div>
          </Drawer.Body>
          <Drawer.CloseTrigger className="app-nodrag" />
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}

export default ProfileSettingDrawer
