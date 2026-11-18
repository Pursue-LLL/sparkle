// [INPUT] @renderer/hooks/use-latest（POS: 最新值 ref）
// [OUTPUT] useProxyGroupState: 代理页各组的展开 / 搜索 / 测速中状态与页面级记忆
// [POS] 代理页状态层：状态数组与 `groups` 按下标对齐，仅在分组数量变化时重新对齐；
//       `rememberProxyGroupOpenState` 开启时，展开/搜索/滚动位置缓存在模块级，离开页面后仍保留。

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'
import { useLatest } from './use-latest'

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

interface ProxyGroupState {
  isOpen: boolean[]
  isOpenContent: boolean[]
  isOpenContentRef: { readonly current: boolean[] }
  searchValue: string[]
  delaying: boolean[]
  initialScrollTop: number
  scrollerRef: RefCallback<Window | HTMLElement>
  toggleOpen: (index: number, currentlyOpen: boolean) => void
  updateSearchValue: (index: number, value: string) => void
  setGroupDelaying: (index: number, value: boolean) => void
  /** 展开分组（先展开外壳，下一拍再渲染内容）。 */
  expandGroup: (index: number) => void
  /** 记住分组的展开状态（仅在 `rememberProxyGroupOpenState` 开启时生效）。 */
  persistGroupOpen: (index: number, open: boolean) => void
}

export function useProxyGroupState(
  groups: ControllerMixedGroup[],
  rememberProxyGroupOpenState: boolean
): ProxyGroupState {
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
  const isOpenContentRef = useLatest(isOpenContent)
  const [delaying, setDelaying] = useState<boolean[]>(Array(groups.length).fill(false))
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
  const [initialScrollTop] = useState(() =>
    rememberProxyGroupOpenState ? proxyGroupPageCache.scrollTop : 0
  )
  const scrollerElRef = useRef<HTMLElement | null>(null)
  const rememberProxyGroupOpenStateRef = useLatest(rememberProxyGroupOpenState)
  const groupsRef = useLatest(groups)

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

  const persistGroupOpen = useCallback((index: number, open: boolean) => {
    if (!rememberProxyGroupOpenStateRef.current) return
    const groupName = groupsRef.current[index]?.name
    if (groupName) proxyGroupPageCache.isOpen[groupName] = open
  }, [])

  const setGroupDelaying = useCallback((index: number, value: boolean): void => {
    setDelaying((prev) => {
      const newDelaying = [...prev]
      newDelaying[index] = value
      return newDelaying
    })
  }, [])

  const expandGroup = useCallback((index: number) => {
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
  }, [])

  const toggleOpen = useCallback((index: number, currentlyOpen: boolean) => {
    const newVal = !currentlyOpen
    persistGroupOpen(index, newVal)
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
        persistGroupOpen(index, true)
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

  return {
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
  }
}
