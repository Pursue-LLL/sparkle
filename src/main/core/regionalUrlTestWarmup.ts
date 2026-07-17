import { appendAppLog } from '../utils/log'
import {
  type RegionalUrlTestWarmupApi,
  warmupRegionalUrlTestGroupsCore
} from './regionalUrlTestWarmupCore'

export type { RegionalUrlTestWarmupApi } from './regionalUrlTestWarmupCore'

/** Warm Sparkle regional url-test groups — must receive main-bundle mihomo API injection. */
export async function warmupRegionalUrlTestGroups(
  api: RegionalUrlTestWarmupApi
): Promise<number> {
  const { warmed, failures } = await warmupRegionalUrlTestGroupsCore(api)

  for (const failure of failures) {
    await appendAppLog(`[RegionalUrlTestWarmup]: ${failure.group} failed, ${failure.error}\n`)
  }

  if (warmed > 0) {
    await appendAppLog(`[RegionalUrlTestWarmup]: warmed ${warmed} regional url-test groups\n`)
  }
  return warmed
}
