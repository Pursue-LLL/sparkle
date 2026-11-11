// [INPUT] regionalUrlTestWarmupCore::warmupRegionalUrlTestGroupsCore (POS: 地区组按需预热核心) · utils/log
// [OUTPUT] warmupRegionalUrlTestGroups · collectActiveWarmupGroupNames（re-export）
// [POS] url-test 预热运行时包装：把需要预热的组集合传给纯函数核心，并记录失败/成功日志。

import { appendAppLog } from '../utils/log'
import {
  type RegionalUrlTestWarmupApi,
  warmupRegionalUrlTestGroupsCore
} from './regionalUrlTestWarmupCore'

export { collectActiveWarmupGroupNames } from './regionalUrlTestWarmupCore'
export type { RegionalUrlTestWarmupApi } from './regionalUrlTestWarmupCore'

/** Warm the url-test groups that need a ready latency sample — must receive main-bundle mihomo API injection. */
export async function warmupRegionalUrlTestGroups(
  api: RegionalUrlTestWarmupApi,
  activeGroupNames: ReadonlySet<string>
): Promise<number> {
  const { warmed, failures } = await warmupRegionalUrlTestGroupsCore(api, activeGroupNames)

  for (const failure of failures) {
    await appendAppLog(`[RegionalUrlTestWarmup]: ${failure.group} failed, ${failure.error}\n`)
  }

  if (warmed > 0) {
    await appendAppLog(`[RegionalUrlTestWarmup]: warmed ${warmed} regional url-test groups\n`)
  }
  return warmed
}
