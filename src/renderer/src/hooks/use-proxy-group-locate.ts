// [INPUT] react-virtuoso（POS: 分组虚拟列表句柄） · @renderer/hooks/use-latest（POS: 最新值 ref） ·
//         @renderer/utils/proxy-group-view（POS: 可见节点折算，取 `ProxyLike` 类型）
// [OUTPUT] useProxyGroupLocate: 「定位当前节点」按钮的滚动逻辑（返回身份稳定的回调）
// [POS] 代理页定位：目标组未展开时先展开，待内容渲染完成后再平滑滚动到当前节点所在行。

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { GroupedVirtuosoHandle } from 'react-virtuoso'
import type { ProxyLike } from '@renderer/utils/proxy-group-view'
import { useLatest } from './use-latest'

interface ProxyGroupLocateInput {
  virtuosoRef: RefObject<GroupedVirtuosoHandle | null>
  groups: ControllerMixedGroup[]
  groupCounts: number[]
  allProxies: ProxyLike[][]
  cols: number
  isOpenContent: boolean[]
  isOpenContentRef: { readonly current: boolean[] }
  expandGroup: (index: number) => void
}

export function useProxyGroupLocate({
  virtuosoRef,
  groups,
  groupCounts,
  allProxies,
  cols,
  isOpenContent,
  isOpenContentRef,
  expandGroup
}: ProxyGroupLocateInput): (index: number) => void {
  const pendingScrollRef = useRef<number | null>(null)

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
        expandGroup(index)
      } else {
        doScrollToCurrentProxy(index)
      }
    },
    [doScrollToCurrentProxy, expandGroup]
  )

  const scrollToCurrentProxyRef = useLatest(scrollToCurrentProxy)
  return useCallback((index: number) => {
    scrollToCurrentProxyRef.current(index)
  }, [])
}
