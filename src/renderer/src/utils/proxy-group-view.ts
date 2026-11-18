// [INPUT] @renderer/utils/includes（POS: 忽略大小写包含） · @sparkle-core/proxyDelayVerdictCore（POS: 延迟判定）
// [OUTPUT] ProxyLike · EMPTY_PROXIES · buildVisibleProxyRows
// [POS] 代理页视图纯函数：把「各组展开/搜索/排序」状态折算为 Virtuoso 的行数与每组可见节点。
import { effectiveProxyDelay, judgeProxyForUrl } from '@sparkle-core/proxyDelayVerdictCore'
import { includesIgnoreCase } from './includes'

export type ProxyLike = ControllerProxiesDetail | ControllerGroupDetail

export const EMPTY_PROXIES: ProxyLike[] = []

function getProxyDelay(proxy: ProxyLike, probeUrl: string): number {
  return effectiveProxyDelay(judgeProxyForUrl(proxy, probeUrl))
}

/** 延迟升序：有延迟的在前，未测试居中，超时（0）垫底。 */
function delayRank(delay: number): number {
  if (delay > 0) return 0
  return delay === -1 ? 1 : 2
}

function createDelayComparator(probeUrl: string): (a: ProxyLike, b: ProxyLike) => number {
  return (a, b) => {
    const delayA = getProxyDelay(a, probeUrl)
    const delayB = getProxyDelay(b, probeUrl)
    const rankA = delayRank(delayA)
    const rankB = delayRank(delayB)
    return rankA === rankB ? (rankA === 0 ? delayA - delayB : 0) : rankA - rankB
  }
}

interface VisibleProxyRowsInput {
  groups: ControllerMixedGroup[]
  isOpenContent: boolean[]
  searchValue: string[]
  proxyDisplayOrder: NonNullable<AppConfig['proxyDisplayOrder']>
  cols: number
  getGroupProbeUrl: (group: ControllerMixedGroup) => string
}

interface VisibleProxyRows {
  groupCounts: number[]
  allProxies: ProxyLike[][]
}

export function buildVisibleProxyRows({
  groups,
  isOpenContent,
  searchValue,
  proxyDisplayOrder,
  cols,
  getGroupProbeUrl
}: VisibleProxyRowsInput): VisibleProxyRows {
  const groupCounts: number[] = []
  const allProxies: ProxyLike[][] = []
  groups.forEach((group, index) => {
    if (isOpenContent[index]) {
      const searchText = searchValue[index] || ''
      let groupProxies = searchText
        ? group.all.filter((proxy) => proxy && includesIgnoreCase(proxy.name, searchText))
        : (group.all as ProxyLike[])

      if (proxyDisplayOrder === 'delay') {
        groupProxies = [...groupProxies].sort(createDelayComparator(getGroupProbeUrl(group)))
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
}
