// [INPUT] autoSwitchPinReleaseCore::planAutoSwitchPinRelease (POS: 固定释放纯决策层) ·
//         utils/errorMessage::describeError · utils/bestEffortLog::bestEffortLog
// [OUTPUT] createAutoSwitchPinReleaser · AutoSwitchPinReleaseDeps
// [POS] 自动切换组固定释放的编排：读分组快照 → 按 scope 决策 → 逐组释放并唤起组内测速。
//       单组释放失败不影响其余组，任何失败只记日志、不抛给调用方；读写内核的动作经 deps 注入，可脱离内核单测。

import { bestEffortLog } from '../utils/bestEffortLog'
import { describeError } from '../utils/errorMessage'
import {
  planAutoSwitchPinRelease,
  type AutoSwitchGroupSnapshot,
  type PinReleaseScope
} from './autoSwitchPinReleaseCore'

export interface AutoSwitchPinReleaseDeps {
  loadGroups: () => Promise<AutoSwitchGroupSnapshot[]>
  unpin: (group: string) => Promise<unknown>
  /** 唤起组内测速，让内核尽快按最新延迟选路；尽力而为，失败被忽略。 */
  probeGroup: (group: string) => Promise<unknown>
  log: (line: string) => Promise<void>
}

/** 返回的函数释放自动切换组的固定并返回成功释放的组数。 */
export function createAutoSwitchPinReleaser(
  deps: AutoSwitchPinReleaseDeps
): (scope: PinReleaseScope) => Promise<number> {
  const writeLog = bestEffortLog(deps.log)

  return async (scope) => {
    let released = 0
    try {
      for (const release of planAutoSwitchPinRelease(await deps.loadGroups(), scope)) {
        try {
          await deps.unpin(release.group)
        } catch (error) {
          await writeLog(
            `[AutoSwitchPin]: release failed group=${release.group} err=${describeError(error)}\n`
          )
          continue
        }
        released += 1
        await writeLog(
          `[AutoSwitchPin]: released ${release.group} pinned=${release.pinnedNode} reason=${release.reason} scope=${scope}\n`
        )
        void deps.probeGroup(release.group).catch(() => {})
      }
    } catch (error) {
      await writeLog(`[AutoSwitchPin]: plan failed scope=${scope} err=${describeError(error)}\n`)
    }
    return released
  }
}
