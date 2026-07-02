import { Button, Card, CardBody, Chip, Tooltip } from '@heroui/react'
import { formatStabilityMarkerTooltip } from '@renderer/hooks/use-commercial-node-stability'
import { mihomoUnfixedProxy } from '@renderer/utils/ipc'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FaMapPin } from 'react-icons/fa6'
import {
  formatProxyDelaySampleAge,
  formatProxyDelayTooltip,
  latestProxyDelayHistoryEntry
} from '@renderer/utils/proxy-delay-sample-age'
import ProxyDetailTooltip from './proxy-detail-tooltip'

interface Props {
  mutateProxies: () => void
  onProxyDelay: (proxy: string, group?: ControllerMixedGroup) => Promise<ControllerProxiesDelay>
  proxyDisplayLayout: 'hidden' | 'single' | 'double'
  showGroupSelectedProxy: boolean
  showProxyDetailTooltip: boolean
  proxy: ControllerProxiesDetail | ControllerGroupDetail
  group: ControllerMixedGroup
  onSelect: (group: string, proxy: string) => void
  selected: boolean
  stabilityMarker?: CommercialNodeStabilityEntry
  benchmarkScore?: CommercialNodeStabilityEntry
}

const isGroup = (
  proxy: ControllerProxiesDetail | ControllerGroupDetail
): proxy is ControllerGroupDetail => {
  return 'now' in proxy && typeof (proxy as ControllerGroupDetail).now === 'string'
}

function delayColor(delay: number): 'primary' | 'success' | 'warning' | 'danger' {
  if (delay === -1) return 'primary'
  if (delay === 0) return 'danger'
  if (delay < 500) return 'success'
  return 'warning'
}

function delayText(delay: number): string {
  if (delay === -1) return '测试'
  if (delay === 0) return '超时'
  return delay.toString()
}

interface ProxyDelayControlProps {
  delay: number
  sampleTime?: string
  loading: boolean
  onDelay: () => void
  buttonClassName: string
  textClassName?: string
}

const ProxyDelayControl: React.FC<ProxyDelayControlProps> = ({
  delay,
  sampleTime,
  loading,
  onDelay,
  buttonClassName,
  textClassName = 'text-xs'
}) => {
  const ageLabel = useMemo(
    () => (delay === -1 ? undefined : formatProxyDelaySampleAge(sampleTime)),
    [delay, sampleTime]
  )
  const tooltip = useMemo(
    () => formatProxyDelayTooltip(delay, sampleTime),
    [delay, sampleTime]
  )

  const button = (
    <Button
      isIconOnly
      isLoading={loading}
      color={delayColor(delay)}
      onPress={onDelay}
      variant="light"
      className={buttonClassName}
    >
      <span className={textClassName}>{delayText(delay)}</span>
    </Button>
  )

  return (
    <div className="flex flex-col items-center shrink-0">
      {tooltip ? (
        <Tooltip content={tooltip} placement="left" delay={200}>
          {button}
        </Tooltip>
      ) : (
        button
      )}
      {ageLabel ? (
        <span
          className="text-[9px] text-foreground-400 leading-none mt-0.5 max-w-[56px] truncate"
          title={tooltip}
        >
          {ageLabel}
        </span>
      ) : null}
    </div>
  )
}

const ProxyItem: React.FC<Props> = (props) => {
  const {
    mutateProxies,
    proxyDisplayLayout,
    showGroupSelectedProxy,
    showProxyDetailTooltip,
    group,
    proxy,
    selected,
    onSelect,
    onProxyDelay,
    stabilityMarker,
    benchmarkScore
  } = props
  const shouldShowGroupSelectedProxy =
    showGroupSelectedProxy && isGroup(proxy) && Boolean(proxy.now)

  const delaySample = useMemo(() => latestProxyDelayHistoryEntry(proxy.history), [proxy.history])
  const delay = delaySample?.delay ?? -1
  const delaySampleTime = delaySample?.time

  const [loading, setLoading] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)
  const touchTriggeredRef = useRef(false)
  const lastTouchTime = useRef(0)
  const [showTooltip, setShowTooltip] = useState(false)

  const handleMouseEnter = useCallback(() => {
    if (Date.now() - lastTouchTime.current < 1000) return
    hoverTimerRef.current = setTimeout(() => {
      setShowTooltip(true)
    }, 600)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (!touchTriggeredRef.current) {
      setShowTooltip(false)
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    lastTouchTime.current = Date.now()
    const touch = e.touches[0]
    touchStartPos.current = { x: touch.clientX, y: touch.clientY }
    touchTriggeredRef.current = false
    touchTimerRef.current = setTimeout(() => {
      touchTriggeredRef.current = true
      setShowTooltip(true)
    }, 600)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPos.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStartPos.current.x)
    const dy = Math.abs(touch.clientY - touchStartPos.current.y)
    if (dx > 8 || dy > 8) {
      if (touchTimerRef.current !== null) {
        clearTimeout(touchTimerRef.current)
        touchTimerRef.current = null
      }
      if (touchTriggeredRef.current) {
        setShowTooltip(false)
        touchTriggeredRef.current = false
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current !== null) {
      clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
    touchStartPos.current = null
  }, [])

  useEffect(() => {
    if (!showTooltip) return
    const handleOutsideTouch = (e: TouchEvent): void => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowTooltip(false)
        touchTriggeredRef.current = false
      }
    }
    document.addEventListener('touchstart', handleOutsideTouch, { passive: true })
    return () => document.removeEventListener('touchstart', handleOutsideTouch)
  }, [showTooltip])

  useEffect(() => {
    if (!showTooltip || touchTriggeredRef.current) return
    const handleMouseMove = (e: MouseEvent): void => {
      if (!wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [showTooltip])

  const onDelay = (): void => {
    setLoading(true)
    onProxyDelay(proxy.name, group).finally(() => {
      mutateProxies()
      setLoading(false)
    })
  }

  const fixed = group.fixed && group.fixed === proxy.name

  const stabilityBadge =
    stabilityMarker !== undefined ? (
      <Tooltip content={formatStabilityMarkerTooltip(stabilityMarker)} placement="top">
        <Chip
          size="sm"
          color="warning"
          variant="flat"
          className="h-4 min-h-4 px-1 text-[10px] ml-1 shrink-0"
        >
          {stabilityMarker.kind === 'vps' ? '24h自建推荐' : '24h商业推荐'}
        </Chip>
      </Tooltip>
    ) : null

  const cursorAgentBadge =
    benchmarkScore && !stabilityMarker ? (
      <Tooltip content={formatStabilityMarkerTooltip(benchmarkScore)} placement="top">
        <Chip
          size="sm"
          color={
            benchmarkScore.cursorStability === 'risk'
              ? 'danger'
              : benchmarkScore.cursorStability === 'watch'
                ? 'warning'
                : benchmarkScore.cursorStability === 'unknown'
                  ? 'default'
                  : 'success'
          }
          variant="flat"
          className="h-4 min-h-4 px-1 text-[10px] ml-1 shrink-0"
        >
          Agent·{benchmarkScore.cursorStabilityLabel}
        </Chip>
      </Tooltip>
    ) : null

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={showProxyDetailTooltip ? handleMouseEnter : undefined}
      onMouseLeave={showProxyDetailTooltip ? handleMouseLeave : undefined}
      onTouchStart={showProxyDetailTooltip ? handleTouchStart : undefined}
      onTouchMove={showProxyDetailTooltip ? handleTouchMove : undefined}
      onTouchEnd={showProxyDetailTooltip ? handleTouchEnd : undefined}
    >
      <Card
        as="div"
        onPress={() => {
          if (touchTriggeredRef.current) {
            touchTriggeredRef.current = false
            return
          }
          onSelect(group.name, proxy.name)
        }}
        isPressable
        fullWidth
        shadow="sm"
        className={`${fixed ? 'bg-secondary/30' : selected ? 'bg-primary/30' : 'bg-content2'}`}
        radius="sm"
      >
        <CardBody className="py-1.5 px-2">
          <div
            className={`flex ${proxyDisplayLayout === 'double' ? 'gap-1' : 'justify-between items-center'}`}
          >
            {proxyDisplayLayout === 'double' ? (
              <>
                <div className="flex flex-col gap-0 flex-1 min-w-0">
                  <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                    <div className="flag-emoji inline">{proxy.name}</div>
                    {stabilityBadge}
                    {cursorAgentBadge}
                  </div>
                  <div className="text-[12px] text-foreground-500 leading-snug mt-0.5 overflow-hidden whitespace-nowrap text-ellipsis">
                    <span>{proxy.type}</span>
                    {proxy.udp !== undefined && !shouldShowGroupSelectedProxy && (
                      <span className="ml-1 opacity-60"> UDP</span>
                    )}
                    {shouldShowGroupSelectedProxy && (
                      <>
                        <span className="mx-1">→</span>
                        <span className="flag-emoji">{proxy.now}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-center gap-0.5 shrink-0">
                  {fixed && (
                    <Button
                      isIconOnly
                      color="danger"
                      onPress={async () => {
                        await mihomoUnfixedProxy(group.name)
                        mutateProxies()
                      }}
                      variant="light"
                      className="h-6 w-6 min-w-6 p-0 text-xs"
                    >
                      <FaMapPin className="text-xs le" />
                    </Button>
                  )}
                  <ProxyDelayControl
                    delay={delay}
                    sampleTime={delaySampleTime}
                    loading={loading}
                    onDelay={onDelay}
                    buttonClassName="h-8 w-8 min-w-8 p-0 text-xs"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="text-ellipsis overflow-hidden whitespace-nowrap">
                  <div className="flag-emoji inline">{proxy.name}</div>
                  {stabilityBadge}
                  {cursorAgentBadge}
                  {proxyDisplayLayout === 'single' && (
                    <>
                      <div className="inline ml-2 text-foreground-500">{proxy.type}</div>
                      {shouldShowGroupSelectedProxy && (
                        <div className="inline ml-2 text-foreground-500 flag-emoji">
                          → {proxy.now}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {fixed && (
                    <div className="flex items-center">
                      <Button
                        isIconOnly
                        color="danger"
                        onPress={async () => {
                          await mihomoUnfixedProxy(group.name)
                          mutateProxies()
                        }}
                        variant="light"
                        className="h-6 w-6 min-w-6 p-0 text-xs"
                      >
                        <FaMapPin className="text-xs le" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center">
                    <ProxyDelayControl
                      delay={delay}
                      sampleTime={delaySampleTime}
                      loading={loading}
                      onDelay={onDelay}
                      buttonClassName="h-full w-8 min-w-8 p-0 text-sm"
                      textClassName="text-sm"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </CardBody>
      </Card>
      {showProxyDetailTooltip && (
        <ProxyDetailTooltip
          proxy={proxy}
          anchorEl={showTooltip ? wrapperRef.current : null}
          visible={showTooltip}
          benchmarkScore={benchmarkScore ?? stabilityMarker}
        />
      )}
    </div>
  )
}

export default React.memo(ProxyItem)
