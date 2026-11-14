// [INPUT] 当前订阅节点 · 地区优先级 · 可选的节点延迟 / 锁区节点 / 沉底节点 ·
//         regionPriority::isBlockedRegionNodeName/nodeMatchesRegion (POS: 地区优先级与地区匹配)
// [OUTPUT] FAST_NODE_PROVIDER_ID · FastProviderOrderOptions · FastProviderExclusions · orderProxiesByRegionPriority · buildSparkleFastProviderDocument · listFlatAutoSelectProxyNames
// [POS] `自动选择` 的专属 provider 文件：按地区优先级分段，剔除香港；
// 有实测延迟样本时，存活节点按地区分段 + 段内延迟升序排在前，无样本（超时/未测）节点按地区序统一垫在文件末尾（无延迟数据时保持订阅顺序）。
// 吞吐实测判劣的「沉底」节点整体后置于文件最末：只要还有别的存活节点就不会被 fallback 选中，全池只剩它们存活时仍可作为最后手段。
// mihomo 解析期不识别 provider 节点名，`自动选择` 通过 use 引用本文件；
// 组类型为 fallback：按此顺序用第一个可用节点，选定后由 autoSelectStickyPin 粘性固定，当前节点真挂掉才降级。
// 纯函数模块（fs/路径由调用方持有），便于单测。

import { isBlockedRegionNodeName, nodeMatchesRegion } from './regionPriority'

export const FAST_NODE_PROVIDER_ID = 'sparkle-fast' as const
export const FAST_NODE_PROVIDER_FILENAME = 'sparkle-fast-proxies.yaml' as const

type ProxyRecord = Record<string, unknown>

function proxyName(proxy: ProxyRecord): string {
  return String(proxy.name ?? '').trim()
}

/** 节点名 → 最近一次探测延迟（毫秒）；缺失或不可用的节点不在表内。 */
export type NodeDelayMap = ReadonlyMap<string, number>

/** 影响文件顺序的运行时证据，均可缺省。 */
export interface FastProviderOrderOptions {
  /** 节点实测延迟：有样本的节点按地区分段 + 段内延迟升序在前，无样本的垫在末尾。 */
  delayMs?: NodeDelayMap
  /** 已确认 Gemini 锁区/送中的节点：不进入文件。 */
  blockedNodeNames?: ReadonlySet<string>
  /** 因下载吞吐实测判劣而沉底的节点：保留在文件，但整体排在最后。 */
  sunkNodeNames?: ReadonlySet<string>
}

/** 写 sparkle-fast 文件的各处必须读取同一份剔除/沉底依据，顺序才不会在写入方之间来回变化。 */
export type FastProviderExclusions = Required<
  Pick<FastProviderOrderOptions, 'blockedNodeNames' | 'sunkNodeNames'>
>

/** 稳定分区：沉底节点整体后移到末尾，两部分各自保持原有相对顺序。 */
function sinkToTail(
  ordered: ProxyRecord[],
  sunkNodeNames: ReadonlySet<string> | undefined
): ProxyRecord[] {
  if (!sunkNodeNames) {
    return ordered
  }
  const isSunk = (proxy: ProxyRecord): boolean => sunkNodeNames.has(proxyName(proxy))
  return [...ordered.filter((proxy) => !isSunk(proxy)), ...ordered.filter(isSunk)]
}

/**
 * 优先地区节点按优先级分段在前，其余国家节点垫底；去重保序；香港与已确认 Gemini 锁区/送中节点不进入。
 * 有实测延迟样本时：所有有样本（探测存活）的节点按地区分段 + 段内延迟升序排在前面，
 * 无样本（探测超时/不可达）的节点按地区顺序统一垫在文件末尾，防止已知死节点挡在低优先地区的活节点前面。
 * 吞吐判劣的沉底节点在以上顺序确定后整体后移到最末。
 * 极端兜底：若排除 `blockedNodeNames` 后候选池为空，则回退保留原候选池，防止空 provider 让整组退化为 COMPATIBLE 直连。
 */
export function orderProxiesByRegionPriority(
  proxies: ProxyRecord[],
  regionPriority: string[],
  options: FastProviderOrderOptions = {}
): ProxyRecord[] {
  const { delayMs, blockedNodeNames, sunkNodeNames } = options
  const buildOrdered = (excludeNames?: ReadonlySet<string>): ProxyRecord[] => {
    const included = new Set<string>()
    const ordered: ProxyRecord[] = []
    // 没有任何延迟样本时所有节点都落进 trailingUnsampled，顺序即订阅里的地区分段顺序
    const trailingUnsampled: ProxyRecord[] = []
    const take = (matches: (name: string) => boolean): void => {
      const sampled: Array<{ proxy: ProxyRecord; delay: number }> = []
      for (const proxy of proxies) {
        const name = proxyName(proxy)
        if (
          !name ||
          included.has(name) ||
          isBlockedRegionNodeName(name) ||
          excludeNames?.has(name) ||
          !matches(name)
        ) {
          continue
        }
        included.add(name)
        const delay = delayMs?.get(name)
        if (delay === undefined) {
          trailingUnsampled.push(proxy)
        } else {
          sampled.push({ proxy, delay })
        }
      }
      // sort 是稳定的：延迟相同的节点保持订阅里的先后
      sampled.sort((a, b) => a.delay - b.delay)
      ordered.push(...sampled.map((item) => item.proxy))
    }
    for (const region of regionPriority) {
      take((name) => nodeMatchesRegion(name, region))
    }
    take(() => true)
    return [...ordered, ...trailingUnsampled]
  }

  const withoutBlocked = buildOrdered(blockedNodeNames)
  return sinkToTail(withoutBlocked.length > 0 ? withoutBlocked : buildOrdered(), sunkNodeNames)
}

export function buildSparkleFastProviderDocument(
  input: {
    proxies: ProxyRecord[]
    regionPriority: string[]
  } & FastProviderOrderOptions
): { proxies: ProxyRecord[] } {
  const { proxies, regionPriority, ...options } = input
  return { proxies: orderProxiesByRegionPriority(proxies, regionPriority, options) }
}

/** 无 provider 模式：`自动选择` 的平铺成员名（与 sparkle-fast 文件同序）。 */
export function listFlatAutoSelectProxyNames(
  proxies: ProxyRecord[],
  regionPriority: string[]
): string[] {
  return orderProxiesByRegionPriority(proxies, regionPriority).map(proxyName)
}
