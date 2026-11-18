// [INPUT] @renderer/utils/ipc（POS: mihomo 测速桥） · @renderer/utils/delay-test（POS: 并发测速） ·
//         @renderer/utils/cursor-proxy-groups（POS: 测速地址解析） · @renderer/hooks/use-latest（POS: 最新值 ref） ·
//         @renderer/utils/notification（POS: 应用通知） · @renderer/utils/format-unknown-error（POS: IPC 错误转可读文本） ·
//         @renderer/utils/proxy-group-view（POS: 可见节点折算，取 `EMPTY_PROXIES` / `ProxyLike`）
// [OUTPUT] useProxyGroupDelayTest: 单节点测速 + 整组测速（返回身份稳定的回调）
// [POS] 代理页手动测速：按「测速地址范围」决定探针 URL；整组测速会先展开该组并在结束后刷新代理组。

import { useCallback } from 'react'
import { mihomoGroupDelay, mihomoProxyDelay } from '@renderer/utils/ipc'
import { runDelayTestsWithConcurrency } from '@renderer/utils/delay-test'
import { resolveDelayTestUrl } from '@renderer/utils/cursor-proxy-groups'
import { notify } from '@renderer/utils/notification'
import { formatUnknownErrorForUi } from '@renderer/utils/format-unknown-error'
import { EMPTY_PROXIES, type ProxyLike } from '@renderer/utils/proxy-group-view'
import { useLatest } from './use-latest'

interface ProxyGroupDelayTestInput {
  groups: ControllerMixedGroup[]
  /** 与 `groups` 按下标对齐的、当前可见（已展开）的节点。 */
  allProxies: ProxyLike[][]
  delayTestUrlScope: AppConfig['delayTestUrlScope']
  delayTestUseGroupApi: boolean
  delayTestConcurrency: number | undefined
  mutate: () => void
  expandGroup: (index: number) => void
  persistGroupOpen: (index: number, open: boolean) => void
  setGroupDelaying: (index: number, value: boolean) => void
}

interface ProxyGroupDelayTest {
  onProxyDelay: (proxy: string, group?: ControllerMixedGroup) => Promise<ControllerProxiesDelay>
  onGroupDelay: (index: number) => void
}

export function useProxyGroupDelayTest({
  groups,
  allProxies,
  delayTestUrlScope,
  delayTestUseGroupApi,
  delayTestConcurrency,
  mutate,
  expandGroup,
  persistGroupOpen,
  setGroupDelaying
}: ProxyGroupDelayTestInput): ProxyGroupDelayTest {
  const getDelayTestUrl = useCallback(
    (group?: ControllerMixedGroup): string | undefined => {
      if (delayTestUrlScope === 'global') return undefined
      return resolveDelayTestUrl(group?.name, group?.testUrl)
    },
    [delayTestUrlScope]
  )

  const onProxyDelay = useCallback(
    async (proxy: string, group?: ControllerMixedGroup): Promise<ControllerProxiesDelay> => {
      return await mihomoProxyDelay(proxy, getDelayTestUrl(group))
    },
    [getDelayTestUrl]
  )

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      const group = groups[index]
      if (!group) return

      const openedProxies = allProxies[index] || EMPTY_PROXIES
      const proxies = openedProxies.length > 0 ? openedProxies : group.all
      if (proxies.length === 0) return

      if (openedProxies.length === 0) {
        persistGroupOpen(index, true)
        expandGroup(index)
      }

      const testUrl = getDelayTestUrl(group)
      setGroupDelaying(index, true)

      try {
        if (delayTestUseGroupApi) {
          await mihomoGroupDelay(group.name, testUrl)
        } else {
          await runDelayTestsWithConcurrency(proxies, delayTestConcurrency, async (proxy) => {
            if (proxy.name === 'DIRECT') {
              return
            }
            try {
              if ('all' in proxy) {
                await mihomoGroupDelay(proxy.name, testUrl)
                return
              }
              await mihomoProxyDelay(proxy.name, testUrl)
            } catch {
              // ignore per-node failures; group batch continues
            }
          })
        }
      } catch (error: unknown) {
        notify(`组测速失败：${formatUnknownErrorForUi(error)}`, {
          forceToast: true,
          variant: 'warning',
          timeout: 6000
        })
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
      setGroupDelaying,
      expandGroup,
      persistGroupOpen
    ]
  )

  const onGroupDelayRef = useLatest(onGroupDelay)
  const onGroupDelayStable = useCallback((index: number) => {
    onGroupDelayRef.current(index)
  }, [])

  return { onProxyDelay, onGroupDelay: onGroupDelayStable }
}
