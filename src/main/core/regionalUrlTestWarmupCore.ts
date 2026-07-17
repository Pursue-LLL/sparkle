import { AUTO_SELECT_DELAY_TEST_URL, isSparkleRegionalAutoSelectGroup } from './cursorProxyGroup'
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
    if (!isSparkleRegionalAutoSelectGroup(group.name)) {
      continue
    }
    if (group.type !== 'URLTest') {
      continue
    }
    try {
      await mihomoGroupDelay(group.name, AUTO_SELECT_DELAY_TEST_URL)
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
