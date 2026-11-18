// [INPUT] @renderer/hooks/use-groups（POS: 代理组数据源） · @renderer/hooks/use-proxy-group-state（POS: 展开/搜索/测速中状态） ·
//         @renderer/hooks/use-proxy-group-delay-test（POS: 单节点/整组测速） · @renderer/hooks/use-proxy-group-locate（POS: 定位当前节点） ·
//         @renderer/hooks/use-proxy-columns（POS: 网格列数） · @renderer/hooks/use-dedicated-group-switches（POS: 专用分组开关状态与切换动作） ·
//         @renderer/hooks/use-latest（POS: 最新值 ref） · @renderer/hooks/use-app-config（POS: 应用配置读写） ·
//         @renderer/hooks/use-controled-mihomo-config（POS: 内核配置读写，取代理模式） ·
//         @renderer/hooks/use-agy-probe-snapshot（POS: agy 真实请求快照） · @renderer/hooks/use-grok-probe-snapshot（POS: grok 真实请求快照） ·
//         @renderer/components/proxies/group-header（POS: 代理页分组标题行） · @renderer/components/proxies/disabled-group-header（POS: 已关闭专用组的占位标题） ·
//         @renderer/components/proxies/proxy-item（POS: 代理页节点卡片） · @renderer/components/proxies/proxy-setting-drawer（POS: 代理页设置抽屉） ·
//         @renderer/components/proxies/probe-warmup-chip（POS: 页头测速预热提示） · @renderer/components/base/base-page（POS: 页面外壳） ·
//         @renderer/utils/ipc（POS: 渲染进程 IPC 唯一入口） · @renderer/utils/proxy-group-view（POS: 可见节点折算） ·
//         @renderer/utils/cursor-proxy-groups（POS: 探针 / 测速地址解析） · @renderer/utils/init（POS: 渲染进程启动信息，取构建标识） ·
//         @sparkle-core/cursorProxyGroup（POS: Sparkle 分组名常量与判定谓词） ·
//         @sparkle-core/dedicatedGroups（POS: 可开关专用组注册表与开关解析） ·
//         @sparkle-core/dedicatedGroupPlaceholderCore（POS: 代理页「已关闭专用组」的占位）
// [OUTPUT] Proxies: 代理组页面（分组渲染、节点选择、手动测速、agy/grok 实测展示、设置抽屉）
// [POS] 代理页容器：计算每组的 probeUrl、按组类型下发 agy/grok 快照、把已关闭的专用组以占位标题插回原位，
//       专用组标题与占位标题的开关显示「展示值」（切换进行中已是目标值），组合 GroupHeader / DisabledGroupHeader / ProxyItem / 设置抽屉。
import { Button, Chip } from '@heroui/react'
import { buildStamp } from '@renderer/utils/init'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { getImageDataURL, mihomoChangeProxy, mihomoCloseConnections } from '@renderer/utils/ipc'
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import { DisabledGroupHeader } from '@renderer/components/proxies/disabled-group-header'
import { GroupHeader, resolveGroupProbeMode } from '@renderer/components/proxies/group-header'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import ProxySettingDrawer from '@renderer/components/proxies/proxy-setting-drawer'
import { MdDoubleArrow, MdTune } from 'react-icons/md'
import { useGroups } from '@renderer/hooks/use-groups'
import { useAgyProbeSnapshot } from '@renderer/hooks/use-agy-probe-snapshot'
import { useGrokProbeSnapshot } from '@renderer/hooks/use-grok-probe-snapshot'
import { useDedicatedGroupSwitches } from '@renderer/hooks/use-dedicated-group-switches'
import { useLatest } from '@renderer/hooks/use-latest'
import { useProxyColumns } from '@renderer/hooks/use-proxy-columns'
import { useProxyGroupDelayTest } from '@renderer/hooks/use-proxy-group-delay-test'
import { useProxyGroupLocate } from '@renderer/hooks/use-proxy-group-locate'
import { useProxyGroupState } from '@renderer/hooks/use-proxy-group-state'
import ProbeWarmupChip from '@renderer/components/proxies/probe-warmup-chip'
import { AGY_DEDICATED_GROUP_NAME, GROK_DEDICATED_GROUP_NAME } from '@sparkle-core/cursorProxyGroup'
import { dedicatedGroupIdOf, type DedicatedGroupId } from '@sparkle-core/dedicatedGroups'
import { withDisabledGroupPlaceholders } from '@sparkle-core/dedicatedGroupPlaceholderCore'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { resolveEffectiveDelayTestUrl } from '@renderer/utils/cursor-proxy-groups'
import { buildVisibleProxyRows } from '@renderer/utils/proxy-group-view'

const Proxies: React.FC = () => {
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups: liveGroups = [], mutate } = useGroups()
  const { switches, displayedSwitches, pendingIds, setEnabled } = useDedicatedGroupSwitches(mutate)
  const { groups, placeholderNames } = useMemo(
    () => withDisabledGroupPlaceholders(liveGroups, switches, pendingIds),
    [liveGroups, switches, pendingIds]
  )
  const agyProbeSnapshot = useAgyProbeSnapshot()
  const grokProbeSnapshot = useGrokProbeSnapshot()
  const { appConfig } = useAppConfig()
  const {
    proxyDisplayLayout = 'double',
    groupDisplayLayout = 'double',
    showGroupSelectedProxy = false,
    showProxyDetailTooltip = true,
    proxyDisplayOrder = 'delay',
    autoCloseConnection = false,
    closeMode = 'all',
    proxyCols = 'auto',
    delayTestUrlScope = 'group',
    delayTestUseGroupApi = false,
    delayTestConcurrency,
    delayTestUrl,
    rememberProxyGroupOpenState = false
  } = appConfig || {}
  const cols = useProxyColumns(proxyCols)
  const {
    isOpen,
    isOpenContent,
    isOpenContentRef,
    searchValue,
    delaying,
    initialScrollTop,
    scrollerRef,
    toggleOpen,
    updateSearchValue,
    setGroupDelaying,
    expandGroup,
    persistGroupOpen
  } = useProxyGroupState(groups, rememberProxyGroupOpenState)
  const [isSettingDrawerOpen, setIsSettingDrawerOpen] = useState(false)
  const [settingDrawerReopenSignal, setSettingDrawerReopenSignal] = useState(0)
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null)

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

  const { groupCounts, allProxies } = useMemo(
    () =>
      buildVisibleProxyRows({
        groups,
        isOpenContent,
        searchValue,
        proxyDisplayOrder,
        cols,
        getGroupProbeUrl
      }),
    [groups, isOpenContent, proxyDisplayOrder, cols, searchValue, getGroupProbeUrl]
  )

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
      await executeProxySwitch(group, proxy)
    },
    [groups, executeProxySwitch]
  )

  const { onProxyDelay, onGroupDelay } = useProxyGroupDelayTest({
    groups,
    allProxies,
    delayTestUrlScope,
    delayTestUseGroupApi,
    delayTestConcurrency,
    mutate,
    expandGroup,
    persistGroupOpen,
    setGroupDelaying
  })

  const scrollToCurrentProxy = useProxyGroupLocate({
    virtuosoRef,
    groups,
    groupCounts,
    allProxies,
    cols,
    isOpenContent,
    isOpenContentRef,
    expandGroup
  })

  // stable refs for Virtuoso callbacks
  const groupsRef = useLatest(groups)
  const groupDisplayLayoutRef = useLatest(groupDisplayLayout)
  const searchValueRef = useLatest(searchValue)
  const delayingRef = useLatest(delaying)
  const groupCountsRef = useLatest(groupCounts)
  const allProxiesRef = useLatest(allProxies)
  const colsRef = useLatest(cols)
  const mutateRef = useLatest(mutate)
  const onProxyDelayRef = useLatest(onProxyDelay)
  const onChangeProxyRef = useLatest(onChangeProxy)
  const proxyDisplayLayoutRef = useLatest(proxyDisplayLayout)
  const showGroupSelectedProxyRef = useLatest(showGroupSelectedProxy)
  const showProxyDetailTooltipRef = useLatest(showProxyDetailTooltip)
  const proxyCols2Ref = useLatest(proxyCols)
  const getGroupProbeUrlRef = useLatest(getGroupProbeUrl)
  const toggleOpenRef = useLatest(toggleOpen)
  const updateSearchValueRef = useLatest(updateSearchValue)
  const placeholderNamesRef = useLatest(placeholderNames)
  const setEnabledRef = useLatest(setEnabled)
  const onToggleDedicated = useCallback((id: DedicatedGroupId, enabled: boolean) => {
    void setEnabledRef.current(id, enabled)
  }, [])

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

  const groupContent = useCallback(
    (index: number) => {
      const g = groupsRef.current
      if (!g[index]) {
        return <div>Never See This</div>
      }
      const dedicatedId = dedicatedGroupIdOf(g[index].name)
      const isLast = index === g.length - 1
      if (dedicatedId && placeholderNamesRef.current.has(g[index].name)) {
        return (
          <DisabledGroupHeader
            id={dedicatedId}
            isLast={isLast}
            enabled={displayedSwitches[dedicatedId]}
            pending={pendingIds.has(dedicatedId)}
            onToggle={onToggleDedicated}
          />
        )
      }
      return (
        <GroupHeader
          index={index}
          group={g[index]}
          probeUrl={getGroupProbeUrlRef.current(g[index])}
          probeMode={resolveGroupProbeMode(g[index].name)}
          isOpen={isOpen[index]}
          isLast={isLast}
          groupDisplayLayout={groupDisplayLayoutRef.current}
          searchValue={searchValueRef.current[index]}
          delaying={delayingRef.current[index]}
          dedicatedId={dedicatedId}
          dedicatedEnabled={dedicatedId ? displayedSwitches[dedicatedId] : false}
          dedicatedPending={dedicatedId ? pendingIds.has(dedicatedId) : false}
          onToggleDedicated={onToggleDedicated}
          onToggle={toggleOpenRef.current}
          onUpdateSearch={updateSearchValueRef.current}
          onScrollToProxy={scrollToCurrentProxy}
          onGroupDelay={onGroupDelay}
        />
      )
    },
    [isOpen, scrollToCurrentProxy, onGroupDelay, displayedSwitches, pendingIds, onToggleDedicated]
  )

  const itemContent = useCallback(
    (index: number, groupIndex: number) => {
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
            probeUrl={getGroupProbeUrlRef.current(grps[groupIndex])}
            proxyDisplayLayout={pLayout}
            showGroupSelectedProxy={showGroupSelected}
            showProxyDetailTooltip={showTooltip}
            selected={proxy.name === grps[groupIndex].now}
            agyProbe={
              grps[groupIndex].name === AGY_DEDICATED_GROUP_NAME
                ? (agyProbeSnapshot[proxy.name] ?? null)
                : undefined
            }
            grokProbe={
              grps[groupIndex].name === GROK_DEDICATED_GROUP_NAME
                ? (grokProbeSnapshot[proxy.name] ?? null)
                : undefined
            }
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
    },
    [agyProbeSnapshot, grokProbeSnapshot]
  )

  return (
    <BasePage
      title={
        <span className="inline-flex items-center gap-2 min-w-0">
          <span>代理组</span>
          {buildStamp ? (
            <Chip
              size="sm"
              variant="flat"
              className="font-mono text-xs app-nodrag shrink-0"
              title={`Sparkle ${buildStamp}`}
            >
              {buildStamp}
            </Chip>
          ) : null}
        </span>
      }
      header={
        <div className="flex items-center gap-2">
          <ProbeWarmupChip />
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
        </div>
      }
    >
      {isSettingDrawerOpen && (
        <ProxySettingDrawer
          reopenSignal={settingDrawerReopenSignal}
          onClose={() => setIsSettingDrawerOpen(false)}
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
