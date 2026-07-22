import { Button, Card, CardBody, Chip } from '@heroui/react'
import { Avatar } from '@heroui-v3/react'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseConnections,
  mihomoGroupDelay,
  mihomoProxyDelay,
  runManagedVpsDelayTestSingle,
  runManagedVpsDelayTests
} from '@renderer/utils/ipc'
import { FaLocationCrosshairs } from 'react-icons/fa6'
import { memo, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import ProxySettingDrawer from '@renderer/components/proxies/proxy-setting-drawer'
import { IoIosArrowBack } from 'react-icons/io'
import { MdDoubleArrow, MdOutlineSpeed, MdTune } from 'react-icons/md'
import { useGroups } from '@renderer/hooks/use-groups'
import { useCommercialNodeStabilityMarkers } from '@renderer/hooks/use-commercial-node-stability'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import {
  isVpsCursorLeafBatch,
  isVpsCursorLeafNode,
  resolveDelayTestConcurrencyForProxies,
  runDelayTestsWithConcurrency
} from '@renderer/utils/delay-test'
import ConfirmModal from '@renderer/components/base/base-confirm'
import {
  cursorProxySwitchConfirmDescription,
  formatDelayTestUrlDisplay,
  isCursorSelectorGroupName,
  resolveDelayTestUrl,
  resolveEffectiveDelayTestUrl
} from '@renderer/utils/cursor-proxy-groups'

type ProxyLike = ControllerProxiesDetail | ControllerGroupDetail

const EMPTY_PROXIES: ProxyLike[] = []

function getProxyDelay(proxy: ProxyLike): number {
  return proxy.history.length > 0 ? proxy.history[proxy.history.length - 1].delay : -1
}

function compareProxyDelay(a: ProxyLike, b: ProxyLike): number {
  const delayA = getProxyDelay(a)
  const delayB = getProxyDelay(b)
  if (delayA === -1) return -1
  if (delayB === -1) return 1
  if (delayA === 0) return 1
  if (delayB === 0) return -1
  return delayA - delayB
}

interface GroupHeaderProps {
  index: number
  group: ControllerMixedGroup
  probeUrl: string
  isOpen: boolean
  isLast: boolean
  groupDisplayLayout: 'hidden' | 'single' | 'double'
  searchValue: string
  delaying: boolean
  onToggle: (index: number, currentlyOpen: boolean) => void
  onUpdateSearch: (index: number, value: string) => void
  onScrollToProxy: (index: number) => void
  onGroupDelay: (index: number) => void
}

const GroupHeader = memo(function GroupHeader({
  index,
  group,
  probeUrl,
  isOpen,
  isLast,
  groupDisplayLayout,
  searchValue,
  delaying,
  onToggle,
  onUpdateSearch,
  onScrollToProxy,
  onGroupDelay
}: GroupHeaderProps) {
  const probeLabel = formatDelayTestUrlDisplay(probeUrl)
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
                    <span
                      className="truncate min-w-0"
                      title={`探针地址: ${probeUrl}`}
                    >
                      探针 {probeLabel}
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
                <Button
                  variant="light"
                  isLoading={delaying}
                  size="sm"
                  isIconOnly
                  onPress={() => onGroupDelay(index)}
                >
                  <MdOutlineSpeed className="text-lg text-foreground-500" />
                </Button>
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

interface ProxyGroupPageCache {
  isOpen: Record<string, boolean>
  searchValue: Record<string, string>
  scrollTop: number
}

const proxyGroupPageCache: ProxyGroupPageCache = {
  isOpen: {},
  searchValue: {},
  scrollTop: 0
}

const Proxies: React.FC = () => {
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups = [], mutate } = useGroups()
  const { appConfig } = useAppConfig()
  const {
    proxyDisplayLayout = 'double',
    groupDisplayLayout = 'double',
    showGroupSelectedProxy = false,
    showProxyDetailTooltip = false,
    proxyDisplayOrder = 'default',
    autoCloseConnection = false,
    closeMode = 'all',
    proxyCols = 'auto',
    delayTestUrlScope = 'group',
    delayTestUseGroupApi = false,
    delayTestConcurrency,
    delayTestUrl,
    rememberProxyGroupOpenState = false
  } = appConfig || {}
  const stabilitySnapshot = useCommercialNodeStabilityMarkers()
  const [cols, setCols] = useState(1)
  const [isOpen, setIsOpen] = useState<boolean[]>(() => {
    if (
      rememberProxyGroupOpenState &&
      groups.length > 0 &&
      Object.keys(proxyGroupPageCache.isOpen).length > 0
    ) {
      return groups.map((group) => proxyGroupPageCache.isOpen[group.name] ?? false)
    }
    return Array(groups.length).fill(false)
  })
  const [isOpenContent, setIsOpenContent] = useState<boolean[]>(isOpen)
  const isOpenContentRef = useRef<boolean[]>(isOpen)
  isOpenContentRef.current = isOpenContent
  const [delaying, setDelaying] = useState(Array(groups.length).fill(false))
  const [searchValue, setSearchValue] = useState<string[]>(() => {
    if (
      rememberProxyGroupOpenState &&
      groups.length > 0 &&
      Object.keys(proxyGroupPageCache.searchValue).length > 0
    ) {
      return groups.map((group) => proxyGroupPageCache.searchValue[group.name] ?? '')
    }
    return Array(groups.length).fill('')
  })
  const [isSettingDrawerOpen, setIsSettingDrawerOpen] = useState(false)
  const [settingDrawerReopenSignal, setSettingDrawerReopenSignal] = useState(0)
  const [pendingProxySwitch, setPendingProxySwitch] = useState<{
    group: string
    proxy: string
    current: string
  } | null>(null)
  const [initialScrollTop] = useState(() =>
    rememberProxyGroupOpenState ? proxyGroupPageCache.scrollTop : 0
  )
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null)
  const pendingScrollRef = useRef<number | null>(null)
  const scrollerElRef = useRef<HTMLElement | null>(null)
  const rememberProxyGroupOpenStateRef = useRef(rememberProxyGroupOpenState)
  rememberProxyGroupOpenStateRef.current = rememberProxyGroupOpenState

  const scrollerRef = useCallback((el: Window | HTMLElement | null) => {
    if (scrollerElRef.current) {
      if (rememberProxyGroupOpenStateRef.current && scrollerElRef.current.isConnected) {
        proxyGroupPageCache.scrollTop = scrollerElRef.current.scrollTop
      }
      scrollerElRef.current.onscroll = null
    }
    scrollerElRef.current = el instanceof HTMLElement ? el : null
    if (scrollerElRef.current) {
      const htmlEl = scrollerElRef.current
      htmlEl.onscroll = () => {
        if (rememberProxyGroupOpenStateRef.current) {
          proxyGroupPageCache.scrollTop = htmlEl.scrollTop
        }
      }
    }
  }, [])

  useEffect(() => {
    const openUpdater = (prev: boolean[]): boolean[] => {
      if (prev.length === groups.length) return prev
      if (
        rememberProxyGroupOpenStateRef.current &&
        Object.keys(proxyGroupPageCache.isOpen).length > 0
      ) {
        return groups.map((group) => proxyGroupPageCache.isOpen[group.name] ?? false)
      }
      return groups.map((_, index) => prev[index] ?? false)
    }
    setIsOpen(openUpdater)
    setIsOpenContent(openUpdater)
    setSearchValue((prev) => {
      if (prev.length === groups.length) return prev
      if (
        rememberProxyGroupOpenStateRef.current &&
        Object.keys(proxyGroupPageCache.searchValue).length > 0
      ) {
        return groups.map((group) => proxyGroupPageCache.searchValue[group.name] ?? '')
      }
      return groups.map((_, index) => prev[index] ?? '')
    })
    setDelaying((prev) =>
      prev.length === groups.length ? prev : groups.map((_, index) => prev[index] || false)
    )
  }, [groups])

  const { groupCounts, allProxies } = useMemo(() => {
    const groupCounts: number[] = []
    const allProxies: ProxyLike[][] = []
    groups.forEach((group, index) => {
      if (isOpenContent[index]) {
        const searchText = searchValue[index] || ''
        let groupProxies = searchText
          ? group.all.filter((proxy) => proxy && includesIgnoreCase(proxy.name, searchText))
          : (group.all as ProxyLike[])

        if (proxyDisplayOrder === 'delay') {
          groupProxies = [...groupProxies].sort(compareProxyDelay)
        }
        if (proxyDisplayOrder === 'name') {
          groupProxies = [...groupProxies].sort((a, b) => a.name.localeCompare(b.name))
        }

        groupCounts.push(Math.ceil(groupProxies.length / cols))
        allProxies.push(groupProxies)
      } else {
        groupCounts.push(0)
        allProxies.push(EMPTY_PROXIES)
      }
    })
    return { groupCounts, allProxies }
  }, [groups, isOpenContent, proxyDisplayOrder, cols, searchValue])

  const executeProxySwitch = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      if (autoCloseConnection) {
        if (closeMode === 'all') {
          await mihomoCloseConnections()
        } else if (closeMode === 'group') {
          await mihomoCloseConnections(group)
        }
      }
      mutate()
    },
    [autoCloseConnection, closeMode, mutate]
  )

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      const groupObj = groups.find((item) => item.name === group)
      const current = groupObj?.now ?? ''
      if (current === proxy) {
        return
      }
      if (isCursorSelectorGroupName(group)) {
        setPendingProxySwitch({ group, proxy, current })
        return
      }
      await executeProxySwitch(group, proxy)
    },
    [groups, executeProxySwitch]
  )

  const getDelayTestUrl = useCallback(
    (group?: ControllerMixedGroup): string | undefined => {
      if (delayTestUrlScope === 'global') return undefined
      return resolveDelayTestUrl(group?.name, group?.testUrl)
    },
    [delayTestUrlScope]
  )

  const getGroupProbeUrl = useCallback(
    (group: ControllerMixedGroup): string =>
      resolveEffectiveDelayTestUrl({
        groupName: group.name,
        groupTestUrl: group.testUrl,
        delayTestUrlScope,
        globalDelayTestUrl: delayTestUrl
      }),
    [delayTestUrl, delayTestUrlScope]
  )

  const onProxyDelay = useCallback(
    async (proxy: string, group?: ControllerMixedGroup): Promise<ControllerProxiesDelay> => {
      if (isVpsCursorLeafNode(proxy)) {
        return runManagedVpsDelayTestSingle(proxy, getDelayTestUrl(group))
      }
      return await mihomoProxyDelay(proxy, getDelayTestUrl(group))
    },
    [getDelayTestUrl]
  )

  const setGroupDelaying = useCallback((index: number, value: boolean): void => {
    setDelaying((prev) => {
      const newDelaying = [...prev]
      newDelaying[index] = value
      return newDelaying
    })
  }, [])

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      const group = groups[index]
      if (!group) return

      const openedProxies = allProxies[index] || EMPTY_PROXIES
      const proxies = openedProxies.length > 0 ? openedProxies : group.all
      if (proxies.length === 0) return

      if (openedProxies.length === 0) {
        if (rememberProxyGroupOpenStateRef.current) {
          proxyGroupPageCache.isOpen[group.name] = true
        }
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
        setTimeout(() => {
          setIsOpenContent((prev) => {
            const newOpen = [...prev]
            newOpen[index] = true
            return newOpen
          })
        }, 0)
      }

      const testUrl = getDelayTestUrl(group)
      setGroupDelaying(index, true)

      try {
        const proxyNames = proxies.map((proxy) => proxy.name)
        if (isVpsCursorLeafBatch(proxyNames)) {
          await runManagedVpsDelayTests(proxyNames, testUrl)
          return
        }

        if (delayTestUseGroupApi) {
          await mihomoGroupDelay(group.name, testUrl)
          return
        }

        const delayConcurrency = resolveDelayTestConcurrencyForProxies(proxyNames, delayTestConcurrency)
        await runDelayTestsWithConcurrency(proxies, delayConcurrency, async (proxy) => {
          try {
            await mihomoProxyDelay(proxy.name, testUrl)
          } catch {
            // ignore
          }
        })
      } catch {
        // ignore
      } finally {
        mutate()
        setGroupDelaying(index, false)
      }
    },
    [
      allProxies,
      groups,
      delayTestUseGroupApi,
      delayTestConcurrency,
      mutate,
      getDelayTestUrl,
      setGroupDelaying
    ]
  )

  const calcCols = useCallback((): number => {
    if (window.matchMedia('(min-width: 1536px)').matches) {
      return 5
    } else if (window.matchMedia('(min-width: 1280px)').matches) {
      return 4
    } else if (window.matchMedia('(min-width: 1024px)').matches) {
      return 3
    } else {
      return 2
    }
  }, [])

  const toggleOpen = useCallback((index: number, currentlyOpen: boolean) => {
    const newVal = !currentlyOpen
    if (rememberProxyGroupOpenStateRef.current) {
      const groupName = groupsRef.current[index]?.name
      if (groupName) proxyGroupPageCache.isOpen[groupName] = newVal
    }
    setIsOpen((prev) => {
      const newOpen = [...prev]
      newOpen[index] = newVal
      return newOpen
    })
    if (currentlyOpen) {
      setIsOpenContent((prev) => {
        const newOpen = [...prev]
        newOpen[index] = false
        return newOpen
      })
    } else {
      setTimeout(() => {
        setIsOpenContent((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }, 0)
    }
  }, [])

  const updateSearchValue = useCallback((index: number, value: string) => {
    if (rememberProxyGroupOpenStateRef.current) {
      const groupName = groupsRef.current[index]?.name
      if (groupName) proxyGroupPageCache.searchValue[groupName] = value
    }
    setSearchValue((prev) => {
      const newSearchValue = [...prev]
      newSearchValue[index] = value
      return newSearchValue
    })
    if (value) {
      setIsOpen((prev) => {
        if (prev[index]) return prev
        if (rememberProxyGroupOpenStateRef.current) {
          const groupName = groupsRef.current[index]?.name
          if (groupName) proxyGroupPageCache.isOpen[groupName] = true
        }
        const newOpen = [...prev]
        newOpen[index] = true
        return newOpen
      })
      setTimeout(() => {
        setIsOpenContent((prev) => {
          if (prev[index]) return prev
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }, 0)
    }
  }, [])

  const doScrollToCurrentProxy = useCallback(
    (index: number) => {
      let i = 0
      for (let j = 0; j < index; j++) {
        i += groupCounts[j]
      }
      const proxies = allProxies[index].length > 0 ? allProxies[index] : groups[index].all
      i += Math.floor(proxies.findIndex((proxy) => proxy.name === groups[index].now) / cols)
      virtuosoRef.current?.scrollToIndex({
        index: Math.floor(i),
        align: 'start',
        behavior: 'smooth'
      })
    },
    [groupCounts, allProxies, groups, cols]
  )

  useEffect(() => {
    if (pendingScrollRef.current !== null && isOpenContent[pendingScrollRef.current]) {
      const index = pendingScrollRef.current
      pendingScrollRef.current = null
      setTimeout(() => doScrollToCurrentProxy(index), 150)
    }
  }, [isOpenContent, doScrollToCurrentProxy])

  const scrollToCurrentProxy = useCallback(
    (index: number) => {
      if (!isOpenContentRef.current[index]) {
        pendingScrollRef.current = index
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
        setTimeout(() => {
          setIsOpenContent((prev) => {
            const newOpen = [...prev]
            newOpen[index] = true
            return newOpen
          })
        }, 0)
      } else {
        doScrollToCurrentProxy(index)
      }
    },
    [doScrollToCurrentProxy]
  )

  const onGroupDelayRef = useRef(onGroupDelay)
  onGroupDelayRef.current = onGroupDelay
  const onGroupDelayStable = useCallback((i: number) => {
    onGroupDelayRef.current(i)
  }, [])

  const scrollToCurrentProxyRef = useRef(scrollToCurrentProxy)
  scrollToCurrentProxyRef.current = scrollToCurrentProxy
  const scrollToCurrentProxyStable = useCallback((i: number) => {
    scrollToCurrentProxyRef.current(i)
  }, [])

  // stable refs for Virtuoso callbacks
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const groupDisplayLayoutRef = useRef(groupDisplayLayout)
  groupDisplayLayoutRef.current = groupDisplayLayout
  const searchValueRef = useRef(searchValue)
  searchValueRef.current = searchValue
  const delayingRef = useRef(delaying)
  delayingRef.current = delaying
  const groupCountsRef = useRef(groupCounts)
  groupCountsRef.current = groupCounts
  const allProxiesRef = useRef(allProxies)
  allProxiesRef.current = allProxies
  const colsRef = useRef(cols)
  colsRef.current = cols
  const mutateRef = useRef(mutate)
  mutateRef.current = mutate
  const onProxyDelayRef = useRef(onProxyDelay)
  onProxyDelayRef.current = onProxyDelay
  const onChangeProxyRef = useRef(onChangeProxy)
  onChangeProxyRef.current = onChangeProxy
  const proxyDisplayLayoutRef = useRef(proxyDisplayLayout)
  proxyDisplayLayoutRef.current = proxyDisplayLayout
  const showGroupSelectedProxyRef = useRef(showGroupSelectedProxy)
  showGroupSelectedProxyRef.current = showGroupSelectedProxy
  const showProxyDetailTooltipRef = useRef(showProxyDetailTooltip)
  showProxyDetailTooltipRef.current = showProxyDetailTooltip
  const proxyCols2Ref = useRef(proxyCols)
  proxyCols2Ref.current = proxyCols
  const getGroupProbeUrlRef = useRef(getGroupProbeUrl)
  getGroupProbeUrlRef.current = getGroupProbeUrl
  const toggleOpenRef = useRef(toggleOpen)
  toggleOpenRef.current = toggleOpen
  const updateSearchValueRef = useRef(updateSearchValue)
  updateSearchValueRef.current = updateSearchValue
  const stabilityMarkersRef = useRef(stabilitySnapshot?.markersByNode ?? {})
  stabilityMarkersRef.current = stabilitySnapshot?.markersByNode ?? {}
  const benchmarkScoresRef = useRef(stabilitySnapshot?.scoresByNode ?? {})
  benchmarkScoresRef.current = stabilitySnapshot?.scoresByNode ?? {}

  useEffect(() => {
    groups.forEach((group) => {
      if (group.icon && group.icon.startsWith('http') && !localStorage.getItem(group.icon)) {
        getImageDataURL(group.icon).then((dataURL) => {
          localStorage.setItem(group.icon, dataURL)
          mutate()
        })
      }
    })
  }, [groups, mutate])

  useEffect(() => {
    if (proxyCols !== 'auto') {
      setCols(parseInt(proxyCols))
      return
    }
    setCols(calcCols())
    const handleResize = (): void => {
      setCols(calcCols())
    }
    window.addEventListener('resize', handleResize)
    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [proxyCols, calcCols])

  const groupContent = useCallback(
    (index: number) => {
      const g = groupsRef.current
      return g[index] ? (
        <GroupHeader
          index={index}
          group={g[index]}
          probeUrl={getGroupProbeUrlRef.current(g[index])}
          isOpen={isOpen[index]}
          isLast={index === g.length - 1}
          groupDisplayLayout={groupDisplayLayoutRef.current}
          searchValue={searchValueRef.current[index]}
          delaying={delayingRef.current[index]}
          onToggle={toggleOpenRef.current}
          onUpdateSearch={updateSearchValueRef.current}
          onScrollToProxy={scrollToCurrentProxyStable}
          onGroupDelay={onGroupDelayStable}
        />
      ) : (
        <div>Never See This</div>
      )
    },
    [isOpen, scrollToCurrentProxyStable, onGroupDelayStable]
  )

  const itemContent = useCallback((index: number, groupIndex: number) => {
    const gc = groupCountsRef.current
    const ap = allProxiesRef.current
    const grps = groupsRef.current
    const c = colsRef.current
    const pCols = proxyCols2Ref.current
    const pLayout = proxyDisplayLayoutRef.current
    const showGroupSelected = showGroupSelectedProxyRef.current
    const showTooltip = showProxyDetailTooltipRef.current
    let innerIndex = index
    for (let i = 0; i < groupIndex; i++) {
      innerIndex -= gc[i]
    }
    const proxies = ap[groupIndex]
    const items: ReactNode[] = []
    for (let i = 0; i < c; i++) {
      const proxy = proxies[innerIndex * c + i]
      if (!proxy) continue
      items.push(
        <ProxyItem
          key={proxy.name}
          mutateProxies={mutateRef.current}
          onProxyDelay={onProxyDelayRef.current}
          onSelect={onChangeProxyRef.current}
          proxy={proxy}
          group={grps[groupIndex]}
          proxyDisplayLayout={pLayout}
          showGroupSelectedProxy={showGroupSelected}
          showProxyDetailTooltip={showTooltip}
          selected={proxy.name === grps[groupIndex].now}
          stabilityMarker={stabilityMarkersRef.current[proxy.name]}
          benchmarkScore={benchmarkScoresRef.current[proxy.name]}
        />
      )
    }
    return proxies ? (
      <div
        style={{
          animation: 'proxy-row-in 0.15s ease both',
          ...(pCols !== 'auto' ? { gridTemplateColumns: `repeat(${pCols}, minmax(0, 1fr))` } : {})
        }}
        className={`grid ${
          pCols === 'auto'
            ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
            : ''
        } ${
          groupIndex === gc.length - 1 && innerIndex === gc[groupIndex] - 1 ? 'pb-2' : ''
        } gap-2 pt-2 mx-2`}
      >
        {items}
      </div>
    ) : (
      <div>Never See This</div>
    )
  }, [stabilitySnapshot?.updatedAt, stabilitySnapshot?.scoresByNode])

  return (
    <BasePage
      title="代理组"
      header={
        <Button
          size="sm"
          isIconOnly
          variant="light"
          className="app-nodrag"
          onPress={() => {
            setIsSettingDrawerOpen(true)
            setSettingDrawerReopenSignal((signal) => signal + 1)
          }}
        >
          <MdTune className="text-lg" />
        </Button>
      }
    >
      {isSettingDrawerOpen && (
        <ProxySettingDrawer
          reopenSignal={settingDrawerReopenSignal}
          onClose={() => setIsSettingDrawerOpen(false)}
        />
      )}
      {pendingProxySwitch && (
        <ConfirmModal
          title="切换 Cursor 节点"
          description={cursorProxySwitchConfirmDescription(
            pendingProxySwitch.group,
            pendingProxySwitch.current,
            pendingProxySwitch.proxy
          )}
          confirmText="确认切换"
          cancelText="取消"
          onChange={(open) => {
            if (!open) {
              setPendingProxySwitch(null)
            }
          }}
          onConfirm={async () => {
            const pending = pendingProxySwitch
            setPendingProxySwitch(null)
            if (pending) {
              await executeProxySwitch(pending.group, pending.proxy)
            }
          }}
        />
      )}
      {mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center">
            <MdDoubleArrow className="text-foreground-500 text-[100px]" />
            <h2 className="text-foreground-500 text-[20px]">直连模式</h2>
          </div>
        </div>
      ) : (
        <div className="h-[calc(100vh-50px)]">
          <GroupedVirtuoso
            ref={virtuosoRef}
            scrollerRef={scrollerRef}
            initialScrollTop={initialScrollTop}
            groupCounts={groupCounts}
            groupContent={groupContent}
            itemContent={itemContent}
            defaultItemHeight={72}
            overscan={200}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
