// [INPUT] cursorProxyGroup::isSparkleAutoSelectSubGroup (POS: Sparkle 组名判定) · mihomo `/connections` 链路 · mihomo 组列表
// [OUTPUT] collectActiveWarmupGroupNames · warmupRegionalUrlTestGroupsCore · RegionalUrlTestWarmupApi
// [POS] 地区 url-test 组的按需预热：只测活动连接链路或当前被上层选中的组，未使用不发起测速。

import { isSparkleAutoSelectSubGroup, resolveDelayTestUrl } from './cursorProxyGroup'
import type { MihomoAutoSwitchApi } from './defaultAutoSwitchProxy'

export type RegionalUrlTestWarmupApi = Pick<
  MihomoAutoSwitchApi,
  'mihomoGroups' | 'mihomoGroupDelay'
>

export interface RegionalUrlTestWarmupResult {
  warmed: number
  failures: Array<{ group: string; error: string }>
}

export function assertRegionalUrlTestWarmupApi(
  api: RegionalUrlTestWarmupApi
): asserts api is Required<RegionalUrlTestWarmupApi> {
  if (typeof api.mihomoGroups !== 'function' || typeof api.mihomoGroupDelay !== 'function') {
    throw new Error('warmupRegionalUrlTestGroups requires injected mihomoGroups/mihomoGroupDelay')
  }
}

/** 只收集正在承载流量或已被上层选中的 Sparkle 地区组；未使用的组不预热。 */
export function collectActiveWarmupGroupNames(
  groups: readonly Pick<ControllerMixedGroup, 'name' | 'now'>[],
  connections: ControllerConnections | undefined
): Set<string> {
  const active = new Set<string>()
  for (const connection of connections?.connections ?? []) {
    for (const chain of connection.chains ?? []) {
      if (isSparkleAutoSelectSubGroup(chain)) {
        active.add(chain)
      }
    }
  }
  for (const group of groups) {
    if (isSparkleAutoSelectSubGroup(group.now)) {
      active.add(group.now)
    }
  }
  return active
}

export async function warmupRegionalUrlTestGroupsCore(
  api: RegionalUrlTestWarmupApi,
  activeGroupNames: ReadonlySet<string>
): Promise<RegionalUrlTestWarmupResult> {
  assertRegionalUrlTestWarmupApi(api)
  const { mihomoGroups, mihomoGroupDelay } = api

  if (activeGroupNames.size === 0) {
    return { warmed: 0, failures: [] }
  }

  const groups = await mihomoGroups()
  if (!groups?.length) {
    return { warmed: 0, failures: [] }
  }

  let warmed = 0
  const failures: Array<{ group: string; error: string }> = []
  for (const group of groups) {
    if (!isSparkleAutoSelectSubGroup(group.name) || !activeGroupNames.has(group.name)) {
      continue
    }
    if (group.type !== 'URLTest') {
      continue
    }
    try {
      // 预热必须用组自身的探测目标（Gemini），否则初始选中的节点与后续探测口径不一致。
      await mihomoGroupDelay(
        group.name,
        resolveDelayTestUrl({ groupName: group.name, groupTestUrl: group.testUrl })
      )
      warmed += 1
    } catch (error) {
      failures.push({
        group: group.name,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { warmed, failures }
}
