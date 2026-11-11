// [INPUT] autoSwitchPinReleaseCore::planAutoSwitchPinRelease (POS: 固定释放纯决策层) ·
//         mihomoApi::mihomoGroups/mihomoUnfixedProxy/mihomoGroupDelay (POS: mihomo 控制器访问层) ·
//         utils/log::appendAppLog (POS: 应用程序运行日志追加写入)
// [OUTPUT] releaseAutoSwitchPins: 按生命周期时点释放自动切换组的固定
// [POS] 自动切换组固定释放执行层。内核启动 / 整配置重载后释放缓存恢复的固定（all）；订阅刷新后只释放孤儿固定（orphans）。
//       节点失活的处理由内核原生保证：URLTest 仅在固定节点存活时才遵循 fixed，Fallback 会清除失活的固定。

import { describeError } from '../utils/errorMessage'
import { appendAppLog } from '../utils/log'
import {
  planAutoSwitchPinRelease,
  type AutoSwitchGroupSnapshot,
  type PinReleaseScope
} from './autoSwitchPinReleaseCore'
import { mihomoGroupDelay, mihomoGroups, mihomoUnfixedProxy } from './mihomoApi'

function toSnapshot(group: ControllerMixedGroup): AutoSwitchGroupSnapshot {
  return {
    name: group.name,
    type: group.type,
    fixed: group.fixed,
    all: group.all.map((member) => member.name)
  }
}

/** 释放自动切换组的固定并唤起组内测速，返回成功释放的组数；失败只记日志，不影响调用方流程。 */
export async function releaseAutoSwitchPins(scope: PinReleaseScope): Promise<number> {
  let released = 0
  try {
    const groups = await mihomoGroups()
    for (const release of planAutoSwitchPinRelease(groups.map(toSnapshot), scope)) {
      try {
        await mihomoUnfixedProxy(release.group)
      } catch (error) {
        await appendAppLog(
          `[AutoSwitchPin]: release failed group=${release.group} err=${describeError(error)}\n`
        )
        continue
      }
      released += 1
      await appendAppLog(
        `[AutoSwitchPin]: released ${release.group} pinned=${release.pinnedNode} reason=${release.reason} scope=${scope}\n`
      )
      void mihomoGroupDelay(release.group).catch(() => {})
    }
  } catch (error) {
    await appendAppLog(`[AutoSwitchPin]: plan failed scope=${scope} err=${describeError(error)}\n`)
  }
  return released
}
