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

export async function warmupRegionalUrlTestGroupsCore(
  api: RegionalUrlTestWarmupApi
): Promise<RegionalUrlTestWarmupResult> {
  assertRegionalUrlTestWarmupApi(api)
  const { mihomoGroups, mihomoGroupDelay } = api

  const groups = await mihomoGroups()
  if (!groups?.length) {
    return { warmed: 0, failures: [] }
  }

  let warmed = 0
  const failures: Array<{ group: string; error: string }> = []
  for (const group of groups) {
    if (!isSparkleAutoSelectSubGroup(group.name)) {
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
